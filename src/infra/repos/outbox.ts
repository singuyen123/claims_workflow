import type { OutboxMessage, OutboxStatus } from '../../domain/types';
import type { Db } from '../db/pool';
import { iso } from './claims';

const COLUMNS =
  'id, claim_id, audit_entry_id, effect_type, payload, idempotency_key, status, attempts, ' +
  'max_attempts, next_attempt_at, locked_by, locked_until, last_error, result, created_at, processed_at';

const isoOrNull = (v: unknown) => (v === null || v === undefined ? null : iso(v));

export function rowToMessage(row: Record<string, unknown>): OutboxMessage {
  return {
    id: row.id as number,
    claim_id: row.claim_id as string,
    audit_entry_id: row.audit_entry_id as string,
    effect_type: row.effect_type as OutboxMessage['effect_type'],
    payload: row.payload as Record<string, unknown>,
    idempotency_key: row.idempotency_key as string,
    status: row.status as OutboxStatus,
    attempts: row.attempts as number,
    max_attempts: row.max_attempts as number,
    next_attempt_at: iso(row.next_attempt_at),
    locked_by: (row.locked_by as string | null) ?? null,
    locked_until: isoOrNull(row.locked_until),
    last_error: (row.last_error as string | null) ?? null,
    result: (row.result as Record<string, unknown> | null) ?? null,
    created_at: iso(row.created_at),
    processed_at: isoOrNull(row.processed_at),
  };
}

export interface OutboxInsert {
  claim_id: string;
  audit_entry_id: string;
  effect_type: OutboxMessage['effect_type'];
  payload: Record<string, unknown>;
  idempotency_key: string;
  created_at: string;
}

/** Inserts messages; a message whose idempotency key already exists is skipped. */
export async function enqueue(db: Db, messages: OutboxInsert[]): Promise<number[]> {
  const ids: number[] = [];
  for (const m of messages) {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO outbox (claim_id, audit_entry_id, effect_type, payload, idempotency_key, next_attempt_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        m.claim_id,
        m.audit_entry_id,
        m.effect_type,
        JSON.stringify(m.payload),
        m.idempotency_key,
        m.created_at,
      ],
    );
    if (rows[0]) ids.push(rows[0].id);
  }
  return ids;
}

/**
 * Atomically leases up to `limit` due messages to `workerId`. `SKIP LOCKED` lets several
 * workers run side by side without taking the same message; an expired lease (a worker that
 * died mid-message) makes the message eligible again.
 */
export async function leaseBatch(
  db: Db,
  workerId: string,
  now: Date,
  leaseMs: number,
  limit: number,
): Promise<OutboxMessage[]> {
  const { rows } = await db.query(
    `UPDATE outbox
        SET status = 'PROCESSING', locked_by = $1, locked_until = $2, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM outbox
         WHERE attempts < max_attempts
           AND ((status IN ('PENDING', 'FAILED') AND next_attempt_at <= $3)
                OR (status = 'PROCESSING' AND locked_until < $3))
         ORDER BY id
         LIMIT $4
         FOR UPDATE SKIP LOCKED)
      RETURNING ${COLUMNS}`,
    [workerId, new Date(now.getTime() + leaseMs).toISOString(), now.toISOString(), limit],
  );
  return rows.map(rowToMessage).sort((a, b) => a.id - b.id);
}

/** Messages whose worker died during their final attempt become DEAD instead of hanging. */
export async function reapExpiredLeases(db: Db, now: Date): Promise<number> {
  const r = await db.query(
    `UPDATE outbox
        SET status = 'DEAD', locked_by = NULL, locked_until = NULL,
            last_error = coalesce(last_error, 'lease expired during the final attempt')
      WHERE status = 'PROCESSING' AND locked_until < $1 AND attempts >= max_attempts`,
    [now.toISOString()],
  );
  return r.rowCount ?? 0;
}

export async function markDone(
  db: Db,
  id: number,
  workerId: string,
  now: Date,
  result: Record<string, unknown>,
): Promise<boolean> {
  const r = await db.query(
    `UPDATE outbox
        SET status = 'DONE', processed_at = $3, result = $4, locked_by = NULL, locked_until = NULL, last_error = NULL
      WHERE id = $1 AND locked_by = $2 AND status = 'PROCESSING'`,
    [id, workerId, now.toISOString(), JSON.stringify(result)],
  );
  return r.rowCount === 1;
}

/** Records a failure; the message is retried at `retryAt` or becomes DEAD after max_attempts. */
export async function markFailed(
  db: Db,
  id: number,
  workerId: string,
  retryAt: Date,
  error: string,
): Promise<OutboxStatus | null> {
  const { rows } = await db.query<{ status: OutboxStatus }>(
    `UPDATE outbox
        SET status = CASE WHEN attempts >= max_attempts THEN 'DEAD' ELSE 'FAILED' END,
            next_attempt_at = $3, last_error = $4, locked_by = NULL, locked_until = NULL
      WHERE id = $1 AND locked_by = $2 AND status = 'PROCESSING'
      RETURNING status`,
    [id, workerId, retryAt.toISOString(), error.slice(0, 2000)],
  );
  return rows[0]?.status ?? null;
}

export async function listOutbox(
  db: Db,
  filter: { status?: OutboxStatus; claimId?: string } = {},
): Promise<OutboxMessage[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    params.push(filter.status);
    where.push(`status = $${params.length}`);
  }
  if (filter.claimId) {
    params.push(filter.claimId);
    where.push(`claim_id = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM outbox ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`,
    params,
  );
  return rows.map(rowToMessage);
}

/** Gives a DEAD message a fresh set of attempts. */
export async function retryDead(db: Db, id: number, now: Date): Promise<boolean> {
  const r = await db.query(
    `UPDATE outbox
        SET status = 'PENDING', attempts = 0, next_attempt_at = $2, last_error = NULL
      WHERE id = $1 AND status = 'DEAD'`,
    [id, now.toISOString()],
  );
  return r.rowCount === 1;
}
