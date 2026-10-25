import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OutboxMessage } from '../../src/domain/types';
import { HANDLERS } from '../../src/infra/outbox/handlers';
import { leaseBatch } from '../../src/infra/repos/outbox';
import { createTestDb, Driver, hasDatabase, type TestDb } from '../helpers/pg-schema';

async function until(check: () => Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(!hasDatabase)('outbox delivery', () => {
  let db: TestDb;
  let d: Driver;
  const logs: string[] = [];
  const worker = (id: string) =>
    db.app.createWorker({ workerId: id, log: (line) => logs.push(line) });

  beforeAll(async () => {
    db = await createTestDb('outbox');
    d = new Driver(db);
  });
  afterAll(() => db?.close());

  it('a refused transition leaves nothing in the outbox', async () => {
    const claimNo = await d.submit();
    const before = await d.count('outbox');
    await d.fail(claimNo, 'verify_documents', 'u_clerk_01');
    expect(await d.count('outbox')).toBe(before);
  });

  it('two workers never take the same message', async () => {
    for (let i = 0; i < 6; i++) await d.submit();
    const seen = new Map<number, string[]>();
    const tracking = (id: string) =>
      db.app.createWorker({
        workerId: id,
        batchSize: 2,
        log: () => undefined,
        handlers: {
          notify: async (m: OutboxMessage, ctx) => {
            seen.set(m.id, [...(seen.get(m.id) ?? []), id]);
            await new Promise((resolve) => setTimeout(resolve, 20));
            return HANDLERS.notify(m, ctx);
          },
        },
      });
    const a = tracking('worker-a');
    const b = tracking('worker-b');
    await Promise.all([a.drain(), b.drain()]);

    expect(seen.size).toBeGreaterThanOrEqual(6);
    expect([...seen.values()].every((workers) => workers.length === 1)).toBe(true);
    expect(new Set([...seen.values()].flat())).toEqual(new Set(['worker-a', 'worker-b']));
    expect(await d.count('outbox', "status <> 'DONE'")).toBe(0);
    expect(await d.count('mock_notifications')).toBe(
      await d.count('outbox', "effect_type = 'notify'"),
    );
  });

  it('a message whose worker died is taken again after the lease expires', async () => {
    const claimNo = await d.submit();
    const claim = await d.service.requireClaim(claimNo);
    const [leased] = await leaseBatch(db.app.pool, 'crashed-worker', db.clock.now(), 30_000, 1);
    expect(leased?.claim_id).toBe(claim.id);

    expect((await worker('rescuer').processOnce()).leased).toBe(0);
    db.clock.advance(31_000);
    const round = await worker('rescuer').processOnce();
    expect(round).toMatchObject({ leased: 1, done: 1 });
    const [message] = await db.app.ops.outbox({ claimId: claim.id });
    expect(message).toMatchObject({ status: 'DONE', attempts: 2, locked_by: null });
  });

  it('gateway failures are retried with backoff and the payment is made exactly once', async () => {
    const claimNo = await d.approved(3_000_000);
    await worker('w').drain();
    await db.app.ops.failNextPayments(2);
    const started = await d.ok(claimNo, 'initiate_payment', 'u_finance_01');
    logs.length = 0;
    await worker('w').drain();

    const [payment] = await db.app.ops
      .outbox({ claimId: started.claim.id })
      .then((list) => list.filter((m) => m.effect_type === 'trigger_payment'));
    expect(payment).toMatchObject({ status: 'DONE', attempts: 3 });
    expect(logs.filter((l) => l.startsWith('[retry]'))).toHaveLength(2);
    const payments = await db.app.ops.payments(started.claim.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      amount: 3_000_000,
      gateway_ref: payment?.result?.gateway_ref,
    });
  });

  it('a message that keeps failing goes DEAD and can be retried by an operator', async () => {
    const claimNo = await d.approved(1_000_000);
    await worker('w').drain();
    await db.app.ops.failNextPayments(10);
    const started = await d.ok(claimNo, 'initiate_payment', 'u_finance_01');
    await worker('w').drain();
    const dead = (await db.app.ops.outbox({ claimId: started.claim.id, status: 'DEAD' }))[0];
    expect(dead).toMatchObject({ effect_type: 'trigger_payment', attempts: 5 });
    expect(dead?.last_error).toContain('injected fault');
    expect(await db.app.ops.payments(started.claim.id)).toEqual([]);

    await db.app.ops.failNextPayments(0);
    expect(await db.app.ops.retryOutbox(dead?.id as number)).toBe(true);
    await worker('w').drain();
    expect(await db.app.ops.payments(started.claim.id)).toHaveLength(1);
  });

  it('delivering the same payment message twice pays once (idempotent handler)', async () => {
    const claimNo = await d.approved(1_500_000);
    const started = await d.ok(claimNo, 'initiate_payment', 'u_finance_01');
    const [message] = (await db.app.ops.outbox({ claimId: started.claim.id })).filter(
      (m) => m.effect_type === 'trigger_payment',
    );
    const ctx = { db: db.app.pool, now: db.clock.now(), log: () => undefined };
    const first = await HANDLERS.trigger_payment(message as OutboxMessage, ctx);
    const second = await HANDLERS.trigger_payment(message as OutboxMessage, ctx);
    expect(second).toEqual({ gateway_ref: first.gateway_ref, duplicate: true });
    expect(await db.app.ops.payments(started.claim.id)).toHaveLength(1);
  });

  it('the long-running worker wakes up on NOTIFY from a committed transition', async () => {
    await worker('w').drain();
    const stop = new AbortController();
    // A one-minute poll interval: only the notification can wake it within the timeout.
    const listener = db.app.createWorker({
      workerId: 'listener',
      pollMs: 60_000,
      log: () => undefined,
    });
    const running = listener.run(stop.signal);
    try {
      await new Promise((resolve) => setTimeout(resolve, 200)); // let it LISTEN
      const result = await d.ok(await d.submit(), 'attach_document', 'u_member_01', {
        document_type: 'claim_form',
      });
      const submitted = await db.app.ops.outbox({ claimId: result.claim.id });
      expect(submitted.length).toBeGreaterThan(0);
      await until(async () =>
        (await db.app.ops.outbox({ claimId: result.claim.id })).every((m) => m.status === 'DONE'),
      );
    } finally {
      stop.abort();
      await running;
    }
  });
});
