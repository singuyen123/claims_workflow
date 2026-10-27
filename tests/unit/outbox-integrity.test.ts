import { describe, expect, it } from 'vitest';
import type { AuditEntry, OutboxMessage } from '../../src/domain/types';
import type { AuditRepository } from '../../src/repositories/audit-repository';
import type { MockGatewayRepository } from '../../src/repositories/mock-gateway-repository';
import type {
  OutboxNotifications,
  OutboxRepository,
} from '../../src/repositories/outbox-repository';
import { buildAuditEntry } from '../../src/services/audit-chain';
import { ManualClock } from '../../src/services/clock';
import { OutboxWorker } from '../../src/services/outbox-worker';
import { verifyOutbox } from '../../src/services/verify';
import { EngineHarness } from '../helpers/engine-harness';

const KEY = 'unit-test-audit-key';

/** A paid claim's audit chain and the outbox rows its transitions queued, as stored. */
function paidClaim() {
  const h = new EngineHarness();
  const claimNo = h.submit();
  h.toAssessment(claimNo);
  h.assess(claimNo, 2_000_000);
  h.ok(claimNo, 'approve', 'u_assessor_01');
  h.ok(claimNo, 'initiate_payment', 'u_finance_01');
  const entries: AuditEntry[] = [];
  const messages: OutboxMessage[] = [];
  for (const plan of h.audit) {
    const prev = entries.at(-1);
    const entry = buildAuditEntry(
      plan,
      prev ? { claim_seq: prev.claim_seq, hash: prev.hash } : null,
      KEY,
    );
    entries.push(entry);
    for (const draft of plan.outbox) {
      messages.push({
        ...draft,
        id: messages.length + 1,
        claim_id: entry.claim_id,
        audit_entry_id: entry.entry_id,
        status: 'PENDING',
        attempts: 1,
        max_attempts: 5,
        next_attempt_at: entry.occurred_at,
        locked_by: 'w',
        locked_until: null,
        last_error: null,
        result: null,
        created_at: entry.occurred_at,
        processed_at: null,
      });
    }
  }
  const payment = messages.find((m) => m.effect_type === 'trigger_payment') as OutboxMessage;
  return { entries, messages, payment };
}

describe('outbox against the audit chain', () => {
  it('accepts the messages the chain recorded', () => {
    const { entries, messages } = paidClaim();
    expect(verifyOutbox(entries, messages)).toEqual([]);
  });

  it('reports a payment whose amount was changed after the fact', () => {
    const { entries, messages, payment } = paidClaim();
    payment.payload = { ...payment.payload, amount: 90_000_000 };
    expect(verifyOutbox(entries, messages).map((i) => i.code)).toEqual(['OUTBOX_TAMPERED']);
  });

  it('reports a message no entry queued, and a queued message that is gone', () => {
    const { entries, messages, payment } = paidClaim();
    const forged = { ...payment, id: 99, idempotency_key: 'payment:forged' };
    const codes = verifyOutbox(entries, [...messages.filter((m) => m !== payment), forged]).map(
      (i) => i.code,
    );
    expect(codes).toEqual(['OUTBOX_TAMPERED', 'OUTBOX_MISSING']);
  });
});

describe('outbox worker', () => {
  function worker(entries: AuditEntry[], leased: OutboxMessage[]) {
    const delivered: number[] = [];
    const failed: Array<[number, string]> = [];
    const outbox = {
      reapExpiredLeases: async () => 0,
      lease: async () => leased,
      markDone: async (id: number) => {
        delivered.push(id);
        return true;
      },
      markFailed: async (id: number, _w: string, _at: Date, error: string) => {
        failed.push([id, error]);
        return 'FAILED' as const;
      },
    } as unknown as OutboxRepository;
    const audit = {
      find: async (id: string) => entries.find((e) => e.entry_id === id) ?? null,
    } as unknown as AuditRepository;
    const handle = async () => ({ ok: true });
    const w = new OutboxWorker({
      outbox,
      audit,
      auditKey: KEY,
      notifications: {} as OutboxNotifications,
      gateway: {} as MockGatewayRepository,
      clock: new ManualClock(new Date('2026-10-20T03:00:00.000Z')),
      log: () => undefined,
      handlers: { notify: handle, trigger_payment: handle, log: handle },
    });
    return { w, delivered, failed };
  }

  it('delivers messages their audit entry vouches for', async () => {
    const { entries, messages } = paidClaim();
    const { w, delivered, failed } = worker(entries, messages);
    await w.processOnce();
    expect(failed).toEqual([]);
    expect(delivered).toEqual(messages.map((m) => m.id));
  });

  it('refuses a payment that differs from its entry, or whose entry was re-signed', async () => {
    const { entries, payment } = paidClaim();
    const changed = { ...payment, payload: { ...payment.payload, amount: 90_000_000 } };
    const resigned = entries.map((e) =>
      e.entry_id === payment.audit_entry_id ? { ...e, notes: 'edited' } : e,
    );
    const first = worker(entries, [changed]);
    await first.w.processOnce();
    const second = worker(resigned, [payment]);
    await second.w.processOnce();
    expect(first.delivered).toEqual([]);
    expect(first.failed[0]?.[1]).toContain('differs from what entry');
    expect(second.delivered).toEqual([]);
    expect(second.failed[0]?.[1]).toContain('fails its HMAC check');
  });
});
