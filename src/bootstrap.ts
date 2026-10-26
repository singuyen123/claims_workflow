// Composition root: the only module that wires PostgreSQL implementations into the services.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { type CompiledWorkflow, loadWorkflowFile } from './engine/load';
import { migrate } from './infra/db/migrate';
import { createPool } from './infra/db/pool';
import { env } from './infra/env';
import { loadSeed } from './infra/seed-file';
import {
  createSchema,
  dropSchema as dropSchemaIn,
  upsertReference,
} from './repositories/postgres/admin';
import { PgOutboxNotifications } from './repositories/postgres/outbox-repository';
import { PgUnitOfWork } from './repositories/postgres/unit-of-work';
import { ClaimQueryService } from './services/claim-query-service';
import { ClaimService, type ClaimServiceOptions } from './services/claim-service';
import { type Clock, systemClock } from './services/clock';
import type { Services } from './services/index';
import { OperationsService } from './services/operations-service';
import { OutboxWorker, type WorkerOptions } from './services/outbox-worker';
import { WorkflowService } from './services/workflow-service';

export type { Services };

/** Options of an outbox worker that callers may set (the rest comes from the app). */
export type WorkerSettings = Omit<WorkerOptions, 'outbox' | 'notifications' | 'gateway' | 'clock'>;

export interface AppContext {
  /** Runtime-role pool, for tests and demos that check database privileges directly. */
  pool: pg.Pool;
  schema: string;
  clock: Clock;
  workflow: CompiledWorkflow;
  services: Services;
  /** Outbox worker on this app's pool and clock. */
  createWorker(options?: WorkerSettings): OutboxWorker;
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
  onAutomatic?: ClaimServiceOptions['onAutomatic'];
}

/** Connects as the runtime role, loads the workflow file and registers its definition. */
export async function createApp(options: AppOptions = {}): Promise<AppContext> {
  const workflow = options.workflow ?? loadWorkflowFile(options.configPath ?? env.workflowConfig());
  const schema = options.schema ?? env.schema();
  const clock = options.clock ?? systemClock;
  // One generator for writes and dry runs, so reproducible ids stay reproducible.
  const newId = options.newId ?? randomUUID;
  const pool = createPool(options.databaseUrl ?? env.databaseUrl(), schema);
  const store = new PgUnitOfWork(pool);
  const auditKey = env.auditKey();
  const workflows = new WorkflowService(workflow, store.repos.definitions, clock);
  const services: Services = {
    claims: new ClaimService({
      store,
      workflows,
      auditKey,
      clock,
      newId,
      ...(options.onAutomatic ? { onAutomatic: options.onAutomatic } : {}),
    }),
    queries: new ClaimQueryService({ repos: store.repos, workflows, auditKey, clock, newId }),
    workflows,
    operations: new OperationsService(store.repos, clock),
  };
  try {
    await workflows.register();
  } catch (error) {
    await pool.end();
    throw error;
  }
  return {
    pool,
    schema,
    clock,
    workflow,
    services,
    createWorker: (settings = {}) =>
      new OutboxWorker({
        ...settings,
        outbox: store.repos.outbox,
        notifications: new PgOutboxNotifications(pool, schema),
        gateway: store.repos.mockGateway,
        clock,
      }),
    close: () => pool.end(),
  };
}

// ── owner-only maintenance: migrations, seed data and (development only) a full reset ─────────

async function asOwner<T>(
  ownerUrl: string,
  schema: string,
  fn: (owner: pg.Pool) => Promise<T>,
): Promise<T> {
  const owner = createPool(ownerUrl, schema, 1);
  try {
    return await fn(owner);
  } finally {
    await owner.end();
  }
}

export function migrateSchema(ownerUrl = env.ownerUrl(), schema = env.schema()) {
  return asOwner(ownerUrl, schema, async (owner) => {
    await createSchema(owner, schema);
    return migrate(owner);
  });
}

export function seedSchema(ownerUrl = env.ownerUrl(), schema = env.schema(), seedPath?: string) {
  return asOwner(ownerUrl, schema, async (owner) => {
    const seed = loadSeed(seedPath);
    await upsertReference(owner, seed);
    return { users: seed.users.length, policies: seed.policies.length };
  });
}

/**
 * Drops the schema with all its data. Audit tables are append-only, so this is the only way to
 * start over; never point it at real data.
 */
export function dropSchema(ownerUrl = env.ownerUrl(), schema = env.schema()) {
  return asOwner(ownerUrl, schema, (owner) => dropSchemaIn(owner, schema));
}

/** Drops, migrates and seeds the schema (development only). */
export async function resetSchema(ownerUrl = env.ownerUrl(), schema = env.schema()) {
  await dropSchema(ownerUrl, schema);
  const migrations = await migrateSchema(ownerUrl, schema);
  const seeded = await seedSchema(ownerUrl, schema);
  return { migrations, seeded };
}
