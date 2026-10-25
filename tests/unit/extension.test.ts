import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAY } from '../../src/app/clock';
import { ConfigError, loadWorkflowFile, loadWorkflowText } from '../../src/engine';
import { BASE_CONFIG, EngineHarness } from '../helpers/engine-harness';

const APPEAL_CONFIG = 'config/examples/workflow.appeal.yaml';

/** A v2 claim rejected by u_assessor_01, inside its appeal window. */
function rejectedClaim(h: EngineHarness): string {
  const claimNo = h.submit();
  h.toAssessment(claimNo);
  h.assess(claimNo, 2_000_000);
  h.ok(claimNo, 'reject', 'u_assessor_01', { reason_code: 'not_covered', reason: 'Not covered' });
  return claimNo;
}

describe('extending the workflow through config only (v2: appeals)', () => {
  it('adds a state and transitions on top of v1', () => {
    const v1 = loadWorkflowFile(BASE_CONFIG);
    const v2 = loadWorkflowFile(APPEAL_CONFIG);
    expect(v2.version).toBe(v1.version + 1);
    expect(v2.warnings).toEqual([]);
    expect(Object.keys(v2.definition.states).filter((s) => !(s in v1.definition.states))).toEqual([
      'UNDER_APPEAL',
    ]);
    expect([...v2.transitions.keys()].filter((id) => !v1.transitions.has(id))).toEqual([
      'file_appeal',
      'reopen_assessment',
    ]);
  });

  it('runs an appeal end to end: a different assessor reviews and approves', () => {
    const h = new EngineHarness(loadWorkflowFile(APPEAL_CONFIG));
    const claimNo = rejectedClaim(h);
    const filed = h.ok(claimNo, 'file_appeal', 'u_member_01', {
      reason: 'The treatment is covered',
    });
    expect(filed.outbox.map((m) => m.payload.template)).toEqual([
      'appeal_received',
      'appeal_review_requested',
    ]);
    h.ok(claimNo, 'assign_assessor', 'u_lead_01', { assessor_id: 'u_assessor_02' });
    h.ok(claimNo, 'reopen_assessment', 'u_lead_01');
    expect(h.claim(claimNo).data.assessment).toBeUndefined();
    h.assess(claimNo, 2_000_000, 'u_assessor_02');
    h.ok(claimNo, 'approve', 'u_assessor_02');

    expect(h.states(claimNo)).toEqual([
      'SUBMITTED',
      'DOCUMENTS_VERIFIED',
      'UNDER_ASSESSMENT',
      'REJECTED',
      'UNDER_APPEAL',
      'UNDER_ASSESSMENT',
      'APPROVED',
    ]);
    expect(h.claim(claimNo).counters).toEqual({ appeals: 1 });
  });

  it('the assessor who rejected the claim cannot review the appeal', () => {
    const h = new EngineHarness(loadWorkflowFile(APPEAL_CONFIG));
    const claimNo = rejectedClaim(h);
    h.ok(claimNo, 'file_appeal', 'u_member_01', { reason: 'Please review again' });
    const error = h.fail(claimNo, 'reopen_assessment', 'u_lead_01');
    expect(error.details.failures?.map((f) => f.code)).toEqual(['SOD_VIOLATION']);
    expect(error.message).toContain('u_assessor_01 rejected this claim');
  });

  it('allows one appeal per claim, inside the appeal window', () => {
    const h = new EngineHarness(loadWorkflowFile(APPEAL_CONFIG));
    const claimNo = rejectedClaim(h);
    h.ok(claimNo, 'file_appeal', 'u_member_01', { reason: 'First appeal' });
    h.ok(claimNo, 'assign_assessor', 'u_lead_01', { assessor_id: 'u_assessor_02' });
    h.ok(claimNo, 'reopen_assessment', 'u_lead_01');
    h.assess(claimNo, undefined, 'u_assessor_02');
    h.ok(claimNo, 'reject', 'u_assessor_02', { reason_code: 'exclusion', reason: 'Excluded' });
    const second = h.fail(claimNo, 'file_appeal', 'u_member_01', { reason: 'Second appeal' });
    expect(second.code).toBe('CYCLE_LIMIT_EXCEEDED');
    expect(second.message).toBe(
      'This claim has already been appealed once; the decision on the appeal is final',
    );

    const late = new EngineHarness(loadWorkflowFile(APPEAL_CONFIG));
    const lateClaim = rejectedClaim(late);
    late.advance(31 * DAY);
    const error = late.fail(lateClaim, 'file_appeal', 'u_member_01', { reason: 'Too late' });
    expect(error.details.failures?.map((f) => f.code)).toEqual(['APPEAL_WINDOW_CLOSED']);
  });

  it('is rejected at load time if the new cycle is not bounded by a counter', () => {
    const text = readFileSync(APPEAL_CONFIG, 'utf8').replace(
      'increments: [appeals]',
      'increments: []',
    );
    expect(() => loadWorkflowText(text, 'no-counter')).toThrow(ConfigError);
    expect(() => loadWorkflowText(text, 'no-counter')).toThrow(
      /unbounded cycle UNDER_ASSESSMENT → REJECTED → UNDER_APPEAL → UNDER_ASSESSMENT/,
    );
  });
});
