// Owner-only maintenance: schema lifecycle and reference data. The runtime role has no privilege
// for any of this, so these functions take a data source connected as the schema owner and are
// not part of `Repositories`.
import type { DataSource, EntitySchema, ObjectLiteral, QueryDeepPartialEntity } from 'typeorm';
import type { Policy, User } from '../../domain/types';
import { SCHEMA_RE } from '../../infra/db/pool';
import { PolicyEntity } from './entities/policy';
import { UserEntity } from './entities/user';

function checkSchema(schema: string) {
  if (!SCHEMA_RE.test(schema)) throw new Error(`Invalid schema name '${schema}'`);
}

export async function createSchema(owner: DataSource, schema: string): Promise<void> {
  checkSchema(schema);
  const runner = owner.createQueryRunner();
  try {
    await runner.createSchema(schema, true);
  } finally {
    await runner.release();
  }
}

/** Drops the schema with all its data; audit tables are append-only, so this is the only reset. */
export async function dropSchema(owner: DataSource, schema: string): Promise<void> {
  checkSchema(schema);
  const runner = owner.createQueryRunner();
  try {
    await runner.dropSchema(schema, true, true);
  } finally {
    await runner.release();
  }
}

/** Inserts or updates users and policies. */
export async function upsertReference(
  owner: DataSource,
  seed: { users: User[]; policies: Policy[] },
): Promise<void> {
  // One row at a time, in file order.
  for (const u of seed.users) await upsert(owner, UserEntity, { ...u });
  for (const p of seed.policies) await upsert(owner, PolicyEntity, { ...p });
}

/** INSERT … ON CONFLICT (id) DO UPDATE of every other column. */
async function upsert<T extends ObjectLiteral>(
  owner: DataSource,
  entity: EntitySchema<T>,
  row: QueryDeepPartialEntity<T>,
) {
  const columns = owner
    .getMetadata(entity)
    .columns.filter((c) => !c.isPrimary)
    .map((c) => c.databaseName);
  await owner
    .createQueryBuilder()
    .insert()
    .into(entity)
    .values(row)
    .orUpdate(columns, ['id'])
    .updateEntity(false)
    .execute();
}

/** Applies pending migrations, each in its own transaction; returns what ran and what did not. */
export async function runMigrations(
  owner: DataSource,
): Promise<{ applied: string[]; skipped: string[] }> {
  const ran = await owner.runMigrations({ transaction: 'each' });
  const applied = ran.map((m) => m.name);
  const skipped = owner.migrations
    .map((m) => m.name ?? m.constructor.name)
    .filter((name) => !applied.includes(name));
  return { applied, skipped };
}
