import type pg from 'pg';
import { type CompiledWorkflow, loadWorkflowFile } from '../engine/load';
import { migrate } from '../infra/db/migrate';
import { createPool, SCHEMA_RE } from '../infra/db/pool';
import { env } from '../infra/env';
import { OutboxWorker, type WorkerOptions } from '../infra/outbox/worker';
import { upsertReference } from '../infra/repos/reference';
import { ClaimService, type ServiceOptions } from './claim-service';
import { type Clock, systemClock } from './clock';
import { DefinitionRegistry } from './definition-registry';
import { Operations } from './operations';
import { loadSeed } from './seed';

export interface AppContext {
  pool: pg.Pool;
  schema: string;
  clock: Clock;
  service: ClaimService;
  ops: Operations;
  workflow: CompiledWorkflow;
  /** Outbox worker on this app's pool and clock. */
  createWorker(options?: Omit<WorkerOptions, 'pool' | 'schema' | 'clock'>): OutboxWorker;
  close(): Promise<void>;
}

export interface AppOptions {
  configPath?: string;
  /** Already-loaded workflow; takes precedence over `configPath`. */
  workflow?: CompiledWorkflow;
  databaseUrl?: string;
  schema?: string;
  clock?: Clock;
  /** Id generator (default random UUIDs); the scenario runner makes ids reproducible. */
  newId?: () => string;
  onAutomatic?: ServiceOptions['onAutomatic'];
}

/** Connects as the runtime role, loads the workflow file and registers its definition. */
export async function createApp(options: AppOptions = {}): Promise<AppContext> {
  const workflow = options.workflow ?? loadWorkflowFile(options.configPath ?? env.workflowConfig());
  const schema = options.schema ?? env.schema();
  const clock = options.clock ?? systemClock;
  const pool = createPool(options.databaseUrl ?? env.databaseUrl(), schema);
  const service = new ClaimService({
    pool,
    registry: new DefinitionRegistry(workflow),
    auditKey: env.auditKey(),
    clock,
    ...(options.newId ? { newId: options.newId } : {}),
    ...(options.onAutomatic ? { onAutomatic: options.onAutomatic } : {}),
  });
  try {
    await service.init();
  } catch (error) {
    await pool.end();
    throw error;
  }
  return {
    pool,
    schema,
    clock,
    service,
    ops: new Operations(pool, clock),
    workflow,
    createWorker: (workerOptions = {}) =>
      new OutboxWorker({ ...workerOptions, pool, schema, clock }),
    close: () => pool.end(),
  };
}

function checkSchema(schema: string) {
  if (!SCHEMA_RE.test(schema)) throw new Error(`Invalid schema name '${schema}'`);
}

/** Owner-only maintenance: migrations, seed data and (development only) a full reset. */
export async function migrateSchema(ownerUrl = env.ownerUrl(), schema = env.schema()) {
  checkSchema(schema);
  const pool = createPool(ownerUrl, schema, 1);
  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    return await migrate(pool);
  } finally {
    await pool.end();
  }
}

export async function seedSchema(
  ownerUrl = env.ownerUrl(),
  schema = env.schema(),
  seedPath?: string,
) {
  checkSchema(schema);
  const pool = createPool(ownerUrl, schema, 1);
  try {
    const seed = loadSeed(seedPath);
    await upsertReference(pool, seed);
    return { users: seed.users.length, policies: seed.policies.length };
  } finally {
    await pool.end();
  }
}

/**
 * Drops the schema with all its data. Audit tables are append-only, so this is the only way to
 * start over; never point it at real data.
 */
export async function dropSchema(ownerUrl = env.ownerUrl(), schema = env.schema()) {
  checkSchema(schema);
  const pool = createPool(ownerUrl, schema, 1);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await pool.end();
  }
}

/** Drops, migrates and seeds the schema (development only). */
export async function resetSchema(ownerUrl = env.ownerUrl(), schema = env.schema()) {
  await dropSchema(ownerUrl, schema);
  const migrations = await migrateSchema(ownerUrl, schema);
  const seeded = await seedSchema(ownerUrl, schema);
  return { migrations, seeded };
}
