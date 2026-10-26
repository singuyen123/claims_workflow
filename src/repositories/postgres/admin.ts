// Owner-only maintenance: schema lifecycle and reference data. The runtime role has no privilege
// for any of this, so these functions take the owner's pool and are not part of `Repositories`.
// The owner pool has a single connection: never run these queries in parallel.
import type pg from 'pg';
import type { Policy, User } from '../../domain/types';
import { SCHEMA_RE } from '../../infra/db/pool';

function checkSchema(schema: string) {
  if (!SCHEMA_RE.test(schema)) throw new Error(`Invalid schema name '${schema}'`);
}

export async function createSchema(owner: pg.Pool, schema: string): Promise<void> {
  checkSchema(schema);
  await owner.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
}

/** Drops the schema with all its data; audit tables are append-only, so this is the only reset. */
export async function dropSchema(owner: pg.Pool, schema: string): Promise<void> {
  checkSchema(schema);
  await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
}

/** Inserts or updates users and policies. */
export async function upsertReference(
  owner: pg.Pool,
  seed: { users: User[]; policies: Policy[] },
): Promise<void> {
  for (const u of seed.users) {
    await owner.query(
      `INSERT INTO users (id, display_name, roles, member_id, service_account)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, roles = EXCLUDED.roles,
         member_id = EXCLUDED.member_id, service_account = EXCLUDED.service_account`,
      [u.id, u.display_name, u.roles, u.member_id, u.service_account],
    );
  }
  for (const p of seed.policies) {
    await owner.query(
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
