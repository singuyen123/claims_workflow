import type { Db } from '../db/pool';
import { iso } from './claims';

// State of the mock payment gateway and notification channel lives in the database, so the
// idempotency guarantees hold even when the CLI and the worker run as separate processes.

/** Consumes one injected failure; returns true when this call should fail. */
export async function consumeFault(db: Db): Promise<boolean> {
  const r = await db.query(
    `UPDATE mock_gateway_faults SET remaining_failures = remaining_failures - 1
      WHERE id = 1 AND remaining_failures > 0`,
  );
  return r.rowCount === 1;
}

export async function setFaults(db: Db, count: number): Promise<void> {
  await db.query('UPDATE mock_gateway_faults SET remaining_failures = $1 WHERE id = 1', [count]);
}

export interface MockPayment {
  idempotency_key: string;
  claim_id: string;
  amount: number;
  reference: string;
  gateway_ref: string;
  created_at: string;
}

/** Records a payment once per idempotency key and returns the payment for that key. */
export async function recordPayment(
  db: Db,
  p: MockPayment,
): Promise<MockPayment & { created: boolean }> {
  const inserted = await db.query(
    `INSERT INTO mock_gateway_payments (idempotency_key, claim_id, amount, reference, gateway_ref, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [p.idempotency_key, p.claim_id, p.amount, p.reference, p.gateway_ref, p.created_at],
  );
  const { rows } = await db.query(
    `SELECT idempotency_key, claim_id, amount, reference, gateway_ref, created_at
       FROM mock_gateway_payments WHERE idempotency_key = $1`,
    [p.idempotency_key],
  );
  const row = rows[0];
  return { ...row, created_at: iso(row.created_at), created: inserted.rowCount === 1 };
}

export async function listPayments(db: Db, claimId?: string): Promise<MockPayment[]> {
  const { rows } = await db.query(
    `SELECT idempotency_key, claim_id, amount, reference, gateway_ref, created_at
       FROM mock_gateway_payments ${claimId ? 'WHERE claim_id = $1' : ''} ORDER BY id`,
    claimId ? [claimId] : [],
  );
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at) }));
}

export interface MockNotification {
  idempotency_key: string;
  claim_id: string;
  template: string;
  channel: string;
  recipient: Record<string, unknown>;
  subject: string | null;
  body: string;
  sent_at: string;
}

export async function recordNotification(db: Db, n: MockNotification): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO mock_notifications (idempotency_key, claim_id, template, channel, recipient, subject, body, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      n.idempotency_key,
      n.claim_id,
      n.template,
      n.channel,
      JSON.stringify(n.recipient),
      n.subject,
      n.body,
      n.sent_at,
    ],
  );
  return r.rowCount === 1;
}

export async function listNotifications(db: Db, claimId?: string): Promise<MockNotification[]> {
  const { rows } = await db.query(
    `SELECT idempotency_key, claim_id, template, channel, recipient, subject, body, sent_at
       FROM mock_notifications ${claimId ? 'WHERE claim_id = $1' : ''} ORDER BY id`,
    claimId ? [claimId] : [],
  );
  return rows.map((r) => ({ ...r, sent_at: iso(r.sent_at) }));
}
