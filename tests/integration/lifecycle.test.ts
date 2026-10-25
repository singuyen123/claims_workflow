import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DAY } from '../../src/app/clock';
import { createTestDb, Driver, hasDatabase, type TestDb } from '../helpers/pg-schema';

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe.skipIf(!hasDatabase)('claim lifecycle on PostgreSQL', () => {
  let db: TestDb;
  let d: Driver;

  beforeAll(async () => {
    db = await createTestDb('lifecycle');
    d = new Driver(db);
  });
  afterAll(() => db?.close());

  it('scenario 1, happy path: every transition is audited with who, when, why and what changed', async () => {
    const claimNo = await d.approved(2_000_000);
    await d.ok(claimNo, 'initiate_payment', 'u_finance_01');
    await d.ok(claimNo, 'confirm_payment', 'u_finance_01', { payment_reference: 'VCB-0001' });
    const closed = await d.ok(claimNo, 'close_paid', 'u_finance_01', { notes: 'Paid in full' });

    expect(closed.claim.state).toBe('CLOSED');
    expect(await d.states(claimNo)).toEqual([
      'SUBMITTED',
      'DOCUMENTS_VERIFIED',
      'UNDER_ASSESSMENT',
      'APPROVED',
      'PAYMENT_INITIATED',
      'CLOSED',
    ]);
    const { claim, entries } = await d.service.audit(claimNo);
    expect(entries.map((e) => e.claim_seq)).toEqual(entries.map((_, i) => i + 1));
    expect(entries.at(-1)).toMatchObject({
      transition_id: 'close_paid',
      from_state: 'PAYMENT_INITIATED',
      to_state: 'CLOSED',
      actor_user_id: 'u_finance_01',
      actor_role: 'finance',
      notes: 'Paid in full',
      claim_version: claim.version,
      config_hash: d.service.workflow.hash,
    });
    for (const e of entries) {
      expect(e.occurred_at).toMatch(ISO_MS);
      expect(e.changes.length).toBeGreaterThan(0);
      expect(e.decision_context).toMatchObject({ config_hash: d.service.workflow.hash });
    }
    const report = await d.service.verify(claimNo);
    expect(report.issues).toEqual([]);
  });

  it('scenario 2, rejection: the reason is audited and the member acknowledgement closes the claim', async () => {
    const claimNo = await d.submit();
    await d.toAssessment(claimNo);
    await d.assess(claimNo);
    const reason = 'Cosmetic treatment is excluded by the policy';
    await d.ok(claimNo, 'reject', 'u_assessor_01', { reason_code: 'exclusion', reason });
    const ack = await d.ok(claimNo, 'acknowledge_rejection', 'u_member_01');

    expect(ack.automatic.map((a) => a.entry.transition_id)).toEqual(['close_rejected']);
    expect(ack.claim.state).toBe('CLOSED');
    const { entries } = await d.service.audit(claimNo);
    expect(entries.find((e) => e.transition_id === 'reject')?.reason).toBe(reason);
    expect(entries.at(-1)).toMatchObject({
      transition_id: 'close_rejected',
      actor_user_id: 'svc_system',
      actor_role: 'system',
    });
    expect(await d.states(claimNo)).toEqual([
      'SUBMITTED',
      'DOCUMENTS_VERIFIED',
      'UNDER_ASSESSMENT',
      'REJECTED',
      'CLOSED',
    ]);
  });

  it('an unacknowledged rejection closes when the system runs after the appeal window', async () => {
    const claimNo = await d.submit();
    await d.toAssessment(claimNo);
    await d.assess(claimNo);
    await d.ok(claimNo, 'reject', 'u_assessor_01', {
      reason_code: 'waiting_period',
      reason: 'Waiting period',
    });

    expect(await d.service.runSystem(claimNo)).toEqual([]);
    db.clock.advance(31 * DAY);
    const results = await d.service.runSystem();
    expect(results.map((r) => [r.claim.claim_no, r.entry.transition_id])).toContainEqual([
      claimNo,
      'close_rejected',
    ]);
    expect((await d.service.requireClaim(claimNo)).state).toBe('CLOSED');
  });

  it('scenario 3, information loop: back to verification, timer reset, counted, then paid', async () => {
    const claimNo = await d.submit();
    await d.toAssessment(claimNo);
    await d.ok(claimNo, 'request_info', 'u_assessor_01', { reason: 'Please send the lab result' });
    expect((await d.fail(claimNo, 'info_received', 'u_clerk_01')).details.failures?.[0]?.code).toBe(
      'NO_NEW_INFORMATION',
    );
    await d.ok(claimNo, 'attach_document', 'u_member_01', { document_type: 'lab_result' });
    await d.ok(claimNo, 'info_received', 'u_clerk_01');
    await d.ok(claimNo, 'start_assessment', 'u_lead_01');
    await d.assess(claimNo, 2_000_000);
    await d.ok(claimNo, 'approve', 'u_assessor_01');
    await d.ok(claimNo, 'initiate_payment', 'u_finance_01');
    await d.ok(claimNo, 'confirm_payment', 'u_finance_01', { payment_reference: 'VCB-0002' });
    const closed = await d.ok(claimNo, 'close_paid', 'u_finance_01');

    expect(await d.states(claimNo)).toEqual([
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
    expect(closed.claim.counters).toEqual({ info_requests: 1 });
    const timers = closed.claim.data.timers as {
      assessment_started_at: string;
      assessment_reset_at: string;
    };
    expect(timers.assessment_reset_at).toMatch(ISO_MS);
    expect(timers.assessment_started_at > timers.assessment_reset_at).toBe(true);
  });

  it('the fourth information request is refused with the escalation message', async () => {
    const claimNo = await d.submit();
    await d.toAssessment(claimNo);
    for (let i = 1; i <= 3; i++) {
      await d.ok(claimNo, 'request_info', 'u_assessor_01', { reason: `Question ${i}` });
      await d.ok(claimNo, 'provide_info', 'u_member_01', { text: `Answer ${i}` });
      await d.ok(claimNo, 'info_received', 'u_clerk_01');
      await d.ok(claimNo, 'start_assessment', 'u_lead_01');
    }
    const error = await d.fail(claimNo, 'request_info', 'u_assessor_01', { reason: 'Question 4' });

    expect(error.code).toBe('CYCLE_LIMIT_EXCEEDED');
    expect(error.message).toBe('Maximum information requests exceeded — escalate to team lead');
    const claim = await d.service.requireClaim(claimNo);
    expect(claim.state).toBe('UNDER_ASSESSMENT');
    expect(claim.counters).toEqual({ info_requests: 3 });
  });

  it('scenario 4, invalid transition: SUBMITTED → APPROVED explains the state and the way there', async () => {
    const claimNo = await d.submit();
    const error = await d.fail(claimNo, 'approve', 'u_assessor_01');

    expect(error.code).toBe('INVALID_TRANSITION');
    expect(error.message).toContain('claim is SUBMITTED');
    expect(error.details.path_to_target).toEqual([
      'verify_documents',
      'start_assessment',
      'approve',
    ]);
    expect(error.details.available?.map((a) => a.transition)).toContain('verify_documents');
    expect((await d.service.requireClaim(claimNo)).version).toBe(1);
  });

  it('scenario 5, unauthorized role: wrong role and role not held are both refused', async () => {
    const claimNo = await d.submit();
    await d.attachRequired(claimNo);
    const wrongRole = await d.fail(claimNo, 'verify_documents', 'u_assessor_01');
    expect(wrongRole.code).toBe('UNAUTHORIZED_ROLE');
    expect(wrongRole.message).toContain('document_clerk');

    const notHeld = await d.fail(
      claimNo,
      'verify_documents',
      'u_assessor_01',
      {},
      'document_clerk',
    );
    expect(notHeld.code).toBe('ROLE_NOT_ASSIGNED');
    expect((await d.service.requireClaim(claimNo)).state).toBe('SUBMITTED');
  });

  it('a failed precondition names what is missing and changes nothing', async () => {
    const claimNo = await d.submit();
    await d.ok(claimNo, 'attach_document', 'u_member_01', { document_type: 'claim_form' });
    const before = await d.service.requireClaim(claimNo);
    const error = await d.fail(claimNo, 'verify_documents', 'u_clerk_01');

    expect(error.code).toBe('PRECONDITION_FAILED');
    expect(error.details.failures?.[0]).toMatchObject({ code: 'DOCUMENTS_MISSING' });
    expect(error.message).toContain('medical_invoice');
    expect(error.message).toContain('prescription');
    expect(await d.service.requireClaim(claimNo)).toEqual(before);
  });

  it('side effects are queued in the outbox by the same transaction', async () => {
    const claimNo = await d.submit();
    await d.attachRequired(claimNo);
    const result = await d.ok(claimNo, 'verify_documents', 'u_clerk_01');

    expect(result.outbox_ids).toHaveLength(1);
    const queued = await db.app.ops.outbox({ claimId: result.claim.id });
    const message = queued.find((m) => m.id === result.outbox_ids[0]);
    expect(message).toMatchObject({
      effect_type: 'notify',
      status: 'PENDING',
      audit_entry_id: result.entry.entry_id,
    });
    expect(message?.payload.template).toBe('ready_for_assessment');
  });
});
