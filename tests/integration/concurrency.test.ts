import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkflowError } from '../../src/engine/errors';
import type { ActRequest } from '../../src/services/claim-service';
import { MINUTE } from '../../src/services/clock';
import { createTestDb, Driver, hasDatabase, type TestDb } from '../helpers/pg-schema';

async function refusal(promise: Promise<unknown>): Promise<WorkflowError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WorkflowError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe.skipIf(!hasDatabase)('concurrency and idempotency', () => {
  let db: TestDb;
  let d: Driver;

  beforeAll(async () => {
    db = await createTestDb('concurrency');
    d = new Driver(db);
  });
  afterAll(() => db?.close());

  const submitRequest = (key: string): ActRequest => ({
    claim: null,
    transition_id: 'submit_claim',
    user_id: 'u_member_01',
    idempotency_key: key,
    input: {
      policy_id: 'POL-001',
      claim_type: 'outpatient',
      claimed_amount: 1_200_000,
      treatment_date: '2026-10-15',
    },
  });

  it('concurrent decisions on one claim are serialised: exactly one wins', async () => {
    const claimNo = await d.submit();
    await d.toAssessment(claimNo);
    await d.assess(claimNo, 2_000_000);
    db.clock.advance(MINUTE);
    const results = await Promise.allSettled([
      d.services.claims.act({ claim: claimNo, transition_id: 'approve', user_id: 'u_assessor_01' }),
      d.services.claims.act({
        claim: claimNo,
        transition_id: 'reject',
        user_id: 'u_assessor_01',
        input: { reason_code: 'other', reason: 'Duplicate of an earlier claim' },
      }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: 'INVALID_TRANSITION' });
    const { entries } = await d.services.queries.audit(claimNo);
    expect(
      entries.filter((e) => e.transition_id === 'approve' || e.transition_id === 'reject'),
    ).toHaveLength(1);
    expect((await d.services.queries.verify(claimNo)).ok).toBe(true);
  });

  it('a stale expected_version is refused with both versions', async () => {
    const claimNo = await d.submit();
    await d.ok(claimNo, 'attach_document', 'u_member_01', { document_type: 'claim_form' });
    const error = await refusal(
      d.services.claims.act({
        claim: claimNo,
        transition_id: 'attach_document',
        user_id: 'u_member_01',
        input: { document_type: 'prescription' },
        expected_version: 1,
      }),
    );
    expect(error.code).toBe('CONCURRENT_MODIFICATION');
    expect(error.details).toMatchObject({ expected_version: 1, current_version: 2 });
  });

  it('the same idempotency key sent twice at once runs the creation once', async () => {
    const before = await d.count('claims');
    db.clock.advance(MINUTE);
    const [a, b] = await Promise.all([
      d.services.claims.act(submitRequest('submit-key-0001')),
      d.services.claims.act(submitRequest('submit-key-0001')),
    ]);

    expect(a.entry.entry_id).toBe(b.entry.entry_id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(await d.count('claims')).toBe(before + 1);
    expect(await d.count('outbox', 'claim_id = $1', [a.claim.id])).toBe(a.outbox_ids.length);
  });

  it('a replayed request adds no audit entry and no side effect', async () => {
    const claimNo = await d.submit();
    await d.attachRequired(claimNo);
    const request: ActRequest = {
      claim: claimNo,
      transition_id: 'verify_documents',
      user_id: 'u_clerk_01',
      idempotency_key: 'verify-key-0001',
    };
    const first = await d.services.claims.act(request);
    const entries = await d.count('audit_log', 'claim_id = $1', [first.claim.id]);
    const messages = await d.count('outbox', 'claim_id = $1', [first.claim.id]);
    db.clock.advance(MINUTE);
    const again = await d.services.claims.act(request);

    expect(again.replayed).toBe(true);
    expect(again.entry.entry_id).toBe(first.entry.entry_id);
    expect(again.outbox_ids).toEqual(first.outbox_ids);
    expect(await d.count('audit_log', 'claim_id = $1', [first.claim.id])).toBe(entries);
    expect(await d.count('outbox', 'claim_id = $1', [first.claim.id])).toBe(messages);
  });

  it('a key reused for a different request or by another user is refused', async () => {
    await d.services.claims.act(submitRequest('submit-key-0002'));
    const different = await refusal(
      d.services.claims.act({
        ...submitRequest('submit-key-0002'),
        input: { ...submitRequest('x').input, claimed_amount: 9 },
      }),
    );
    expect(different.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const otherUser = await refusal(
      d.services.claims.act({ ...submitRequest('submit-key-0002'), user_id: 'u_clerk_01' }),
    );
    expect(otherUser.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('malformed idempotency keys are refused before touching the database', async () => {
    const error = await refusal(d.services.claims.act(submitRequest('short')));
    expect(error.code).toBe('INVALID_INPUT');
  });
});
