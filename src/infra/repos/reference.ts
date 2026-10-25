import type { SeedData } from '../../app/seed';
import type { Policy, User } from '../../domain/types';
import type { CompiledWorkflow } from '../../engine/load';
import type { Db } from '../db/pool';
import { iso } from './claims';

export async function loadUsers(db: Db): Promise<User[]> {
  const { rows } = await db.query(
    'SELECT id, display_name, roles, member_id, service_account FROM users ORDER BY id',
  );
  return rows.map((r) => ({
    id: r.id,
    display_name: r.display_name,
    roles: r.roles,
    member_id: r.member_id ?? null,
    service_account: r.service_account,
  }));
}

export async function findPolicy(db: Db, id: string | undefined): Promise<Policy | null> {
  if (!id) return null;
  const { rows } = await db.query(
    `SELECT id, member_id, product, coverage_limit, currency, effective_from, effective_to
       FROM policies WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  return r
    ? {
        id: r.id,
        member_id: r.member_id,
        product: r.product,
        coverage_limit: r.coverage_limit,
        currency: r.currency,
        effective_from: r.effective_from,
        effective_to: r.effective_to,
      }
    : null;
}

export async function listPolicies(db: Db): Promise<Policy[]> {
  const { rows } = await db.query('SELECT id FROM policies ORDER BY id');
  const policies = await Promise.all(rows.map((r) => findPolicy(db, r.id as string)));
  return policies.filter((p): p is Policy => p !== null);
}

/** Inserts or updates users and policies (owner connection). */
export async function upsertReference(db: Db, seed: SeedData): Promise<void> {
  for (const u of seed.users) {
    await db.query(
      `INSERT INTO users (id, display_name, roles, member_id, service_account)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, roles = EXCLUDED.roles,
         member_id = EXCLUDED.member_id, service_account = EXCLUDED.service_account`,
      [u.id, u.display_name, u.roles, u.member_id, u.service_account],
    );
  }
  for (const p of seed.policies) {
    await db.query(
      `INSERT INTO policies (id, member_id, product, coverage_limit, currency, effective_from, effective_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET member_id = EXCLUDED.member_id, product = EXCLUDED.product,
         coverage_limit = EXCLUDED.coverage_limit, currency = EXCLUDED.currency,
         effective_from = EXCLUDED.effective_from, effective_to = EXCLUDED.effective_to`,
      [
        p.id,
        p.member_id,
        p.product,
        p.coverage_limit,
        p.currency,
        p.effective_from,
        p.effective_to,
      ],
    );
  }
}

// ── workflow definitions ─────────────────────────────────────────────────────────────────────

export interface StoredDefinition {
  config_hash: string;
  workflow_id: string;
  version: number;
  content: unknown;
  registered_at: string;
}

export async function findDefinition(db: Db, hash: string): Promise<StoredDefinition | null> {
  const { rows } = await db.query(
    'SELECT config_hash, workflow_id, version, content, registered_at FROM workflow_definitions WHERE config_hash = $1',
    [hash],
  );
  return rows[0] ? { ...rows[0], registered_at: iso(rows[0].registered_at) } : null;
}

export async function findDefinitionByVersion(
  db: Db,
  workflowId: string,
  version: number,
): Promise<StoredDefinition | null> {
  const { rows } = await db.query(
    `SELECT config_hash, workflow_id, version, content, registered_at
       FROM workflow_definitions WHERE workflow_id = $1 AND version = $2`,
    [workflowId, version],
  );
  return rows[0] ? { ...rows[0], registered_at: iso(rows[0].registered_at) } : null;
}

export async function insertDefinition(db: Db, wf: CompiledWorkflow, now: Date): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO workflow_definitions (config_hash, workflow_id, version, content, registered_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (config_hash) DO NOTHING`,
    [wf.hash, wf.id, wf.version, JSON.stringify(wf.file), now.toISOString()],
  );
  return r.rowCount === 1;
}

export async function listDefinitions(db: Db): Promise<Omit<StoredDefinition, 'content'>[]> {
  const { rows } = await db.query(
    `SELECT config_hash, workflow_id, version, registered_at FROM workflow_definitions
      ORDER BY workflow_id, version`,
  );
  return rows.map((r) => ({ ...r, registered_at: iso(r.registered_at) }));
}

// ── idempotency keys ─────────────────────────────────────────────────────────────────────────

export interface IdempotencyRecord {
  key: string;
  actor_user_id: string;
  request_hash: string;
  claim_id: string | null;
  response: Record<string, unknown>;
  created_at: string;
}

export async function findIdempotency(db: Db, key: string): Promise<IdempotencyRecord | null> {
  const { rows } = await db.query(
    'SELECT key, actor_user_id, request_hash, claim_id, response, created_at FROM idempotency_keys WHERE key = $1',
    [key],
  );
  return rows[0] ? { ...rows[0], created_at: iso(rows[0].created_at) } : null;
}

export async function saveIdempotency(db: Db, r: IdempotencyRecord): Promise<void> {
  await db.query(
    `INSERT INTO idempotency_keys (key, actor_user_id, request_hash, claim_id, response, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [r.key, r.actor_user_id, r.request_hash, r.claim_id, JSON.stringify(r.response), r.created_at],
  );
}
