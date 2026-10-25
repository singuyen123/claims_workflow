import type { AuditEntry, DeniedAttempt } from '../../domain/types';
import type { Db } from '../db/pool';
import { iso } from './claims';

const COLUMNS =
  'entry_id, claim_id, claim_seq, transition_id, from_state, to_state, actor_user_id, actor_role, ' +
  'reason, notes, input, changes, decision_context, effects, config_hash, claim_version, ' +
  'snapshot_hash, prev_hash, hash, occurred_at';

export function rowToEntry(row: Record<string, unknown>): AuditEntry {
  return {
    entry_id: row.entry_id as string,
    claim_id: row.claim_id as string,
    claim_seq: row.claim_seq as number,
    transition_id: row.transition_id as string,
    from_state: (row.from_state as string | null) ?? null,
    to_state: row.to_state as string,
    actor_user_id: row.actor_user_id as string,
    actor_role: row.actor_role as string,
    reason: (row.reason as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    input: row.input as Record<string, unknown>,
    changes: row.changes as AuditEntry['changes'],
    decision_context: row.decision_context as Record<string, unknown>,
    effects: row.effects as AuditEntry['effects'],
    config_hash: row.config_hash as string,
    claim_version: row.claim_version as number,
    snapshot_hash: row.snapshot_hash as string,
    prev_hash: row.prev_hash as string,
    hash: row.hash as string,
    occurred_at: iso(row.occurred_at),
  };
}

export async function insertEntry(db: Db, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (${COLUMNS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [
      e.entry_id,
      e.claim_id,
      e.claim_seq,
      e.transition_id,
      e.from_state,
      e.to_state,
      e.actor_user_id,
      e.actor_role,
      e.reason,
      e.notes,
      JSON.stringify(e.input),
      JSON.stringify(e.changes),
      JSON.stringify(e.decision_context),
      JSON.stringify(e.effects),
      e.config_hash,
      e.claim_version,
      e.snapshot_hash,
      e.prev_hash,
      e.hash,
      e.occurred_at,
    ],
  );
}

export async function listEntries(db: Db, claimId: string): Promise<AuditEntry[]> {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM audit_log WHERE claim_id = $1 ORDER BY claim_seq`,
    [claimId],
  );
  return rows.map(rowToEntry);
}

export async function findEntry(db: Db, entryId: string): Promise<AuditEntry | null> {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM audit_log WHERE entry_id = $1`, [
    entryId,
  ]);
  return rows[0] ? rowToEntry(rows[0]) : null;
}

/** Last link of a claim's chain. Call after locking the claim row. */
export async function chainHead(
  db: Db,
  claimId: string,
): Promise<{ claim_seq: number; hash: string } | null> {
  const { rows } = await db.query<{ claim_seq: number; hash: string }>(
    'SELECT claim_seq, hash FROM audit_log WHERE claim_id = $1 ORDER BY claim_seq DESC LIMIT 1',
    [claimId],
  );
  return rows[0] ?? null;
}

export interface DeniedRecord {
  claim_id: string | null;
  actor_user_id: string;
  actor_role: string | null;
  transition_id: string;
  error_code: string;
  message: string;
  details: Record<string, unknown>;
  occurred_at: string;
}

/**
 * Records a refused attempt, at most once per (claim, user, transition, code) and minute.
 * Returns false when an identical refusal was already recorded in the same minute.
 */
export async function recordDenied(db: Db, d: DeniedRecord): Promise<boolean> {
  const bucket = new Date(d.occurred_at);
  bucket.setUTCSeconds(0, 0);
  const result = await db.query(
    `INSERT INTO denied_attempts
       (claim_id, actor_user_id, actor_role, transition_id, error_code, message, details, occurred_at, bucket_start)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT ON CONSTRAINT denied_attempts_dedupe DO NOTHING`,
    [
      d.claim_id,
      d.actor_user_id,
      d.actor_role,
      d.transition_id,
      d.error_code,
      d.message,
      JSON.stringify(d.details),
      d.occurred_at,
      bucket.toISOString(),
    ],
  );
  return result.rowCount === 1;
}

export async function listDenied(db: Db, claimId?: string): Promise<DeniedAttempt[]> {
  const { rows } = await db.query(
    `SELECT id, claim_id, actor_user_id, actor_role, transition_id, error_code, message, details, occurred_at
       FROM denied_attempts ${claimId ? 'WHERE claim_id = $1' : ''} ORDER BY id`,
    claimId ? [claimId] : [],
  );
  return rows.map((r) => ({
    id: r.id,
    claim_id: r.claim_id,
    actor_user_id: r.actor_user_id,
    actor_role: r.actor_role,
    transition_id: r.transition_id,
    error_code: r.error_code,
    message: r.message,
    details: r.details,
    occurred_at: iso(r.occurred_at),
  }));
}
