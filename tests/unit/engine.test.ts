import jsonpatch from 'fast-json-patch';
import { describe, expect, it } from 'vitest';
import type { ClaimSnapshot } from '../../src/domain/types';
import { evaluateTransition, hashValue, resolveActor } from '../../src/engine';
import { EngineHarness } from '../helpers/engine-harness';

const MAX_INFO_MESSAGE = 'Maximum information requests exceeded — escalate to team lead';

function approveAndPay(h: EngineHarness, claimNo: string, amount = 2_000_000) {
  h.assess(claimNo, amount);
  h.ok(claimNo, 'approve', 'u_assessor_01');
  h.ok(claimNo, 'initiate_payment', 'u_finance_01');
  h.ok(claimNo, 'confirm_payment', 'u_finance_01', { payment_reference: 'VCB-20261020-0001' });
  h.ok(claimNo, 'close_paid', 'u_finance_01');
}

describe('valid transitions', () => {
  it('happy path: SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → APPROVED → PAYMENT_INITIATED → CLOSED', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    approveAndPay(h, claimNo);
    expect(h.states(claimNo)).toEqual([
      'SUBMITTED',
      'DOCUMENTS_VERIFIED',
      'UNDER_ASSESSMENT',
      'APPROVED',
      'PAYMENT_INITIATED',
      'CLOSED',
    ]);
    const claim = h.claim(claimNo);
    expect(claim.data.payment_request).toMatchObject({ amount: 2_000_000 });
    expect(claim.data.payment).toMatchObject({ confirmation_ref: 'VCB-20261020-0001' });
  });

  it('rejection path closes automatically when the member acknowledges', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    h.assess(claimNo, undefined);
    h.ok(claimNo, 'reject', 'u_assessor_01', {
      reason_code: 'pre_existing_condition',
      reason: 'Condition existed before the policy start date (clause 4.2).',
    });
    expect(h.claim(claimNo).state).toBe('REJECTED');
    h.ok(claimNo, 'acknowledge_rejection', 'u_member_01');
    const last = h.audit.at(-1);
    expect(h.claim(claimNo).state).toBe('CLOSED');
    expect(last?.transition_id).toBe('close_rejected');
    expect(last?.decision_context.actor).toMatchObject({ user_id: 'svc_system', role: 'system' });
    expect(h.states(claimNo)).toEqual([
      'SUBMITTED',
      'DOCUMENTS_VERIFIED',
      'UNDER_ASSESSMENT',
      'REJECTED',
      'CLOSED',
    ]);
  });

  it('a rejected claim closes only after the appeal period when not acknowledged', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    h.assess(claimNo, undefined);
    h.ok(claimNo, 'reject', 'u_assessor_01', {
      reason_code: 'exclusion',
      reason: 'Cosmetic treatment is excluded.',
    });
    const early = h.fail(claimNo, 'close_rejected', 'svc_system');
    expect(early.code).toBe('PRECONDITION_FAILED');
    expect(early.details.failures?.[0]?.code).toBe('APPEAL_WINDOW_OPEN');
    h.advance(31 * 24 * 3600 * 1000);
    h.ok(claimNo, 'close_rejected', 'svc_system');
    expect(h.claim(claimNo).state).toBe('CLOSED');
    expect(h.claim(claimNo).data.archived_at).toBeTypeOf('string');
  });

  it('request-more-info loop returns to assessment and is counted', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    h.ok(claimNo, 'request_info', 'u_assessor_01', { reason: 'Please send the lab results.' });
    h.ok(claimNo, 'attach_document', 'u_member_01', { document_type: 'lab_result' });
    h.ok(claimNo, 'info_received', 'u_clerk_01');
    expect(h.claim(claimNo).data.timers).toMatchObject({ assessment_reset_at: expect.any(String) });
    expect(
      (h.claim(claimNo).data.timers as Record<string, unknown>).assessment_started_at,
    ).toBeUndefined();
    h.ok(claimNo, 'start_assessment', 'u_lead_01');
    approveAndPay(h, claimNo);
    expect(h.states(claimNo)).toEqual([
      'SUBMITTED',
      'DOCUMENTS_VERIFIED',
      'UNDER_ASSESSMENT',
      'PENDING_INFO',
      'DOCUMENTS_VERIFIED',
      'UNDER_ASSESSMENT',
      'APPROVED',
      'PAYMENT_INITIATED',
      'CLOSED',
    ]);
    expect(h.claim(claimNo).counters.info_requests).toBe(1);
  });
});

describe('invalid transitions', () => {
  it('rejects SUBMITTED → APPROVED with the available moves and the path to APPROVED', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    const error = h.fail(claimNo, 'approve', 'u_assessor_01');
    expect(error.code).toBe('INVALID_TRANSITION');
    expect(error.message).toContain(`claim ${claimNo} is SUBMITTED`);
    expect(error.message).toContain('verify_documents → DOCUMENTS_VERIFIED [document_clerk]');
    expect(error.message).toContain(
      'To reach APPROVED: verify_documents → start_assessment → approve',
    );
    expect(error.details.path_to_target).toEqual([
      'verify_documents',
      'start_assessment',
      'approve',
    ]);
  });

  it('suggests the closest transition for a typo', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    const error = h.fail(claimNo, 'aprove', 'u_assessor_01');
    expect(error.code).toBe('UNKNOWN_TRANSITION');
    expect(error.message).toContain("Did you mean 'approve'?");
  });

  it('refuses any transition on a closed claim', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    approveAndPay(h, claimNo);
    const error = h.fail(claimNo, 'request_info', 'u_assessor_01', { reason: 'x' });
    expect(error.code).toBe('TERMINAL_STATE');
    expect(error.message).toContain('is CLOSED, a terminal state');
  });

  it('refuses an in-state action outside its states', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    const error = h.fail(claimNo, 'attach_document', 'u_member_01', {
      document_type: 'lab_result',
    });
    expect(error.code).toBe('INVALID_TRANSITION');
    expect(error.message).toContain('SUBMITTED|PENDING_INFO → same state');
  });
});

describe('preconditions', () => {
  it('lists the missing documents when verifying an incomplete claim', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.ok(claimNo, 'attach_document', 'u_member_01', { document_type: 'claim_form' });
    const error = h.fail(claimNo, 'verify_documents', 'u_clerk_01');
    expect(error.code).toBe('PRECONDITION_FAILED');
    expect(error.details.failures).toEqual([
      {
        code: 'DOCUMENTS_MISSING',
        message: 'Missing required documents for outpatient claim: medical_invoice, prescription',
        details: { missing: ['medical_invoice', 'prescription'] },
      },
    ]);
  });

  it('requires an assigned assessor before assessment starts', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.attachRequired(claimNo);
    h.ok(claimNo, 'verify_documents', 'u_clerk_01');
    const error = h.fail(claimNo, 'start_assessment', 'u_lead_01');
    expect(error.details.failures?.map((f) => f.code)).toEqual(['ASSESSOR_NOT_ASSIGNED']);
  });

  it('refuses approval above the policy limit', () => {
    const h = new EngineHarness();
    const claimNo = h.submit({ policy: 'POL-002', user: 'u_member_02', amount: 7_000_000 });
    h.attachRequired(claimNo, 'u_member_02');
    h.ok(claimNo, 'verify_documents', 'u_clerk_01');
    h.ok(claimNo, 'assign_assessor', 'u_lead_01', { assessor_id: 'u_assessor_01' });
    h.ok(claimNo, 'start_assessment', 'u_lead_01');
    h.assess(claimNo, 6_000_000);
    const error = h.fail(claimNo, 'approve', 'u_assessor_01');
    expect(error.details.failures?.[0]).toMatchObject({
      code: 'AMOUNT_EXCEEDS_POLICY_LIMIT',
      message: 'Approved amount 6,000,000 VND exceeds the policy limit of 5,000,000 VND',
    });
  });

  it('requires a rejection reason and code', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    h.assess(claimNo, undefined);
    const error = h.fail(claimNo, 'reject', 'u_assessor_01');
    expect(error.code).toBe('PRECONDITION_FAILED');
    expect(error.details.failures?.map((f) => f.code)).toEqual([
      'INPUT_REQUIRED',
      'INPUT_REQUIRED',
    ]);
    expect(error.message).toContain(
      "Rejection reason (sent to the member) is required (input 'reason')",
    );
  });

  it('requires a description of the missing information', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    const error = h.fail(claimNo, 'request_info', 'u_assessor_01');
    expect(error.details.failures?.[0]).toMatchObject({
      code: 'INPUT_REQUIRED',
      details: { input: 'reason' },
    });
  });

  it('does not return to verification until something new arrives', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    h.ok(claimNo, 'request_info', 'u_assessor_01', { reason: 'Lab results please.' });
    const error = h.fail(claimNo, 'info_received', 'u_clerk_01');
    expect(error.details.failures?.[0]?.code).toBe('NO_NEW_INFORMATION');
    h.ok(claimNo, 'provide_info', 'u_member_01', { text: 'Results attached by email.' });
    h.ok(claimNo, 'info_received', 'u_clerk_01');
  });

  it('does not close a paid claim before payment is confirmed', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    h.assess(claimNo, 2_000_000);
    h.ok(claimNo, 'approve', 'u_assessor_01');
    h.ok(claimNo, 'initiate_payment', 'u_finance_01');
    const error = h.fail(claimNo, 'close_paid', 'u_finance_01');
    expect(error.details.failures?.[0]?.code).toBe('PAYMENT_NOT_CONFIRMED');
  });

  it('reports every failed precondition at once, without follow-on noise', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    const error = h.fail(claimNo, 'approve', 'u_assessor_01');
    // The limit and four-eyes checks read approved_amount, which is already reported missing.
    expect(error.details.failures?.map((f) => f.code)).toEqual([
      'ASSESSMENT_INCOMPLETE',
      'APPROVED_AMOUNT_MISSING',
    ]);
    expect(error.message).toBe(
      `Cannot run approve on claim ${claimNo}: The assessment report has not been submitted; The assessment report has no approved amount`,
    );
  });

  it('reports independent failures together', () => {
    const h = new EngineHarness();
    const claimNo = h.submit({ amount: 90_000_000, policy: 'POL-002', user: 'u_member_02' });
    h.attachRequired(claimNo, 'u_member_02');
    h.ok(claimNo, 'verify_documents', 'u_clerk_01');
    h.ok(claimNo, 'assign_assessor', 'u_lead_01', { assessor_id: 'u_assessor_01' });
    h.ok(claimNo, 'start_assessment', 'u_lead_01');
    h.assess(claimNo, 60_000_000);
    const error = h.fail(claimNo, 'approve', 'u_assessor_01');
    expect(error.details.failures?.map((f) => f.code)).toEqual([
      'AMOUNT_EXCEEDS_POLICY_LIMIT',
      'FOUR_EYES_REQUIRED',
    ]);
  });

  it('rejects malformed input before evaluating rules', () => {
    const h = new EngineHarness();
    const error = h.fail(null, 'submit_claim', 'u_member_01', {
      policy_id: 'POL-001',
      claim_type: 'outpatiant',
      claimed_amount: 'abc',
      treatment_date: '2026-10-15',
    });
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.message).toContain("Did you mean 'outpatient'?");
    expect(error.message).toContain('must be a whole number of VND');
  });

  it('checks policy cover and the filing deadline at submission', () => {
    const h = new EngineHarness();
    const error = h.fail(null, 'submit_claim', 'u_member_01', {
      policy_id: 'POL-001',
      claim_type: 'outpatient',
      claimed_amount: 1_000_000,
      treatment_date: '2025-06-01',
    });
    expect(error.details.failures?.map((f) => f.code)).toEqual([
      'POLICY_NOT_ACTIVE',
      'FILING_DEADLINE_PASSED',
    ]);
  });
});

describe('role-based and attribute-based authorization', () => {
  it('refuses a transition from the wrong role', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.attachRequired(claimNo);
    const error = h.fail(claimNo, 'verify_documents', 'u_assessor_01');
    expect(error.code).toBe('UNAUTHORIZED_ROLE');
    expect(error.message).toBe(
      "Role 'assessor' cannot run verify_documents (SUBMITTED → DOCUMENTS_VERIFIED). Required: document_clerk.",
    );
  });

  it('refuses a role the user does not hold', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    const error = h.fail(claimNo, 'verify_documents', 'u_clerk_01', {}, { role: 'finance' });
    expect(error.code).toBe('ROLE_NOT_ASSIGNED');
  });

  it('keeps system transitions for the service account', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    h.assess(claimNo, undefined);
    h.ok(claimNo, 'reject', 'u_assessor_01', { reason_code: 'other', reason: 'Not covered.' });
    expect(h.fail(claimNo, 'close_rejected', 'u_lead_01').code).toBe('UNAUTHORIZED_ROLE');
    // A human account that somehow holds the system role is still refused.
    const wf = h.wf;
    const claim = h.claim(claimNo);
    const impostor = {
      id: 'u_x',
      display_name: 'X',
      roles: ['system'],
      member_id: null,
      service_account: false,
    };
    const actor = resolveActor(wf, impostor, 'u_x', 'system');
    const result = evaluateTransition(
      wf,
      claim,
      { transition_id: 'close_rejected', actor },
      { policy: h.policy(claim.policy_id), getUser: h.getUser },
      { now: h.now, newId: h.newId },
    );
    expect(result.ok ? 'ok' : result.error.code).toBe('SERVICE_ACCOUNT_ONLY');
  });

  it('only the assigned assessor can decide', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo, 'u_assessor_01');
    h.assess(claimNo, 2_000_000);
    const error = h.fail(claimNo, 'approve', 'u_assessor_02');
    expect(error.code).toBe('ACCESS_DENIED');
    expect(error.details.failures?.[0]).toMatchObject({
      code: 'NOT_ASSIGNED_ASSESSOR',
      message: 'Only the assigned assessor (u_assessor_01) can act on this claim',
    });
  });

  it('segregation of duties: whoever verified the documents cannot assess', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.attachRequired(claimNo);
    h.ok(claimNo, 'verify_documents', 'u_dual_ca', {}, { role: 'document_clerk' });
    const error = h.fail(claimNo, 'assign_assessor', 'u_lead_01', { assessor_id: 'u_dual_ca' });
    expect(error.details.failures?.[0]).toMatchObject({
      code: 'SOD_VIOLATION',
      message:
        "Segregation of duties: u_dual_ca verified this claim's documents and cannot assess it",
    });
  });

  it('segregation of duties: whoever approved cannot initiate the payment', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo, 'u_dual_af');
    h.assess(claimNo, 2_000_000, 'u_dual_af');
    h.ok(claimNo, 'approve', 'u_dual_af', {}, { role: 'assessor' });
    const error = h.fail(claimNo, 'initiate_payment', 'u_dual_af', {}, { role: 'finance' });
    expect(error.code).toBe('ACCESS_DENIED');
    expect(error.message).toBe(
      'Segregation of duties: u_dual_af took part in the decision on this claim',
    );
    h.ok(claimNo, 'initiate_payment', 'u_finance_01');
  });

  it('four-eyes: large approvals need a team lead co-sign for the exact amount', () => {
    const h = new EngineHarness();
    const claimNo = h.submit({ amount: 90_000_000, type: 'inpatient' });
    h.toAssessment(claimNo);
    h.assess(claimNo, 80_000_000);
    const missing = h.fail(claimNo, 'approve', 'u_assessor_01');
    expect(missing.details.failures?.[0]).toMatchObject({
      code: 'FOUR_EYES_REQUIRED',
      message:
        '80,000,000 VND exceeds the single-approver limit of 50,000,000 VND: a team lead must co-sign this exact amount',
    });
    h.ok(claimNo, 'cosign_approval', 'u_lead_01');
    h.assess(claimNo, 85_000_000); // a new report invalidates the co-sign
    expect(h.fail(claimNo, 'approve', 'u_assessor_01').details.failures?.[0]?.code).toBe(
      'FOUR_EYES_REQUIRED',
    );
    h.ok(claimNo, 'cosign_approval', 'u_lead_01');
    h.ok(claimNo, 'approve', 'u_assessor_01');
    expect(h.claim(claimNo).state).toBe('APPROVED');
  });

  it('members act only on their own policies and claims', () => {
    const h = new EngineHarness();
    const notOwner = h.fail(null, 'submit_claim', 'u_member_02', {
      policy_id: 'POL-001',
      claim_type: 'outpatient',
      claimed_amount: 1_000_000,
      treatment_date: '2026-10-15',
    });
    expect(notOwner.details.failures?.[0]?.code).toBe('NOT_POLICY_HOLDER');
    const claimNo = h.submit();
    const error = h.fail(claimNo, 'attach_document', 'u_member_02', {
      document_type: 'claim_form',
    });
    expect(error.details.failures?.[0]?.code).toBe('NOT_CLAIM_OWNER');
  });
});

describe('cycle limit', () => {
  function requestAndAnswer(h: EngineHarness, claimNo: string) {
    h.ok(claimNo, 'request_info', 'u_assessor_01', { reason: 'More detail please.' });
    h.ok(claimNo, 'provide_info', 'u_member_01', { text: 'Here it is.' });
    h.ok(claimNo, 'info_received', 'u_clerk_01');
    h.ok(claimNo, 'start_assessment', 'u_lead_01');
  }

  it('allows three information requests and refuses the fourth with the escalation message', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    requestAndAnswer(h, claimNo);
    requestAndAnswer(h, claimNo);
    requestAndAnswer(h, claimNo);
    expect(h.claim(claimNo).counters.info_requests).toBe(3);
    const error = h.fail(claimNo, 'request_info', 'u_assessor_01', { reason: 'Again?' });
    expect(error.code).toBe('CYCLE_LIMIT_EXCEEDED');
    expect(error.message).toBe(MAX_INFO_MESSAGE);
    expect(error.details.counter).toEqual({ name: 'info_requests', value: 3, max: 3 });
    expect(h.claim(claimNo).state).toBe('UNDER_ASSESSMENT');
  });

  it('decides from the claim snapshot alone, without reading history', () => {
    const h = new EngineHarness();
    const claim: ClaimSnapshot = {
      id: 'c-1',
      claim_no: 'CLM-2026-999999',
      config_hash: h.wf.hash,
      policy_id: 'POL-001',
      member_id: 'MEM-001',
      claim_type: 'outpatient',
      claimed_amount: 1_000_000,
      state: 'UNDER_ASSESSMENT',
      state_entered_at: '2026-10-20T00:00:00.000Z',
      version: 9,
      data: { assessor_id: 'u_assessor_01' },
      counters: { info_requests: 3 },
      participants: {},
      created_at: '2026-10-19T00:00:00.000Z',
      updated_at: '2026-10-20T00:00:00.000Z',
    };
    const actor = resolveActor(h.wf, h.getUser('u_assessor_01'), 'u_assessor_01');
    const result = evaluateTransition(
      h.wf,
      claim,
      { transition_id: 'request_info', actor, input: { reason: 'x' } },
      { policy: h.policy('POL-001'), getUser: h.getUser },
      { now: h.now, newId: h.newId },
    );
    expect(result.ok ? 'ok' : result.error.message).toBe(MAX_INFO_MESSAGE);
  });
});

describe('transition plan', () => {
  it('records a replayable patch, the snapshot hash and the decision context', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    h.assess(claimNo, 2_000_000);
    const before = structuredClone(h.claim(claimNo));
    const plan = h.ok(claimNo, 'approve', 'u_assessor_01', { notes: 'All good.' });
    const ops = plan.changes as Parameters<typeof jsonpatch.applyPatch>[1];
    const replayed = jsonpatch.applyPatch(structuredClone(before), ops).newDocument;
    expect(replayed).toEqual(plan.after);
    expect(plan.snapshot_hash).toBe(hashValue(plan.after));
    expect(plan.notes).toBe('All good.');
    expect(plan.decision_context).toMatchObject({
      config_hash: h.wf.hash,
      actor: { user_id: 'u_assessor_01', role: 'assessor' },
      reads: {
        'policy.coverage_limit': 100_000_000,
        'settings.four_eyes_threshold': 50_000_000,
        'claim.assessment.approved_amount': 2_000_000,
        'claim.assessment.summary?': true,
      },
    });
    expect(plan.after.participants.approve).toEqual(['u_assessor_01']);
  });

  it('renders notifications and keys the payment by claim and payment request', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    h.assess(claimNo, 2_000_000);
    const approve = h.ok(claimNo, 'approve', 'u_assessor_01');
    expect(approve.outbox[0]).toMatchObject({
      effect_type: 'notify',
      payload: {
        template: 'claim_approved',
        to: { kind: 'member', member_id: 'MEM-001' },
        body: `Your claim ${claimNo} was approved for 2,000,000 VND. Payment will follow.`,
      },
    });
    const pay = h.ok(claimNo, 'initiate_payment', 'u_finance_01');
    const requestId = (h.claim(claimNo).data.payment_request as { id: string }).id;
    expect(pay.outbox).toEqual([
      {
        effect_type: 'trigger_payment',
        idempotency_key: `payment:${h.claim(claimNo).id}:${requestId}`,
        payload: expect.objectContaining({
          amount: 2_000_000,
          reference: requestId,
          currency: 'VND',
        }),
      },
    ]);
  });

  it('dry-runs the available transitions with a checklist', () => {
    const h = new EngineHarness();
    const claimNo = h.submit();
    h.toAssessment(claimNo);
    const available = h.available(claimNo, 'u_assessor_01');
    const byId = Object.fromEntries(available.map((t) => [t.id, t]));
    expect(byId.approve?.allowed).toBe(false);
    expect(byId.approve?.checks.find((c) => !c.ok)?.code).toBe('ASSESSMENT_INCOMPLETE');
    expect(byId.request_info?.allowed).toBe(true);
    expect(byId.request_info?.checks.find((c) => c.stage === 'counter')?.message).toBe(
      'info_requests 0/3',
    );
    expect(byId.assign_assessor?.role_ok).toBe(false);
  });
});
