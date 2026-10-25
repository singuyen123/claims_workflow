import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { type AppContext, createApp, migrateSchema, seedSchema } from '../../src/app/bootstrap';
import type { ActRequest, ActResult } from '../../src/app/claim-service';
import { ManualClock, MINUTE } from '../../src/app/clock';
import { WorkflowError } from '../../src/engine/errors';
import { type CompiledWorkflow, loadWorkflowFile } from '../../src/engine/load';
import { createPool } from '../../src/infra/db/pool';
import { loadEnv } from '../../src/infra/env';

loadEnv();

/**
 * Integration tests run only when TEST_DATABASE_URL is set (see .env.example). When it is set,
 * a database that cannot be reached is a test failure, not a skip.
 */
export const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);

/** Owner credentials (TEST_DATABASE_URL): creates, migrates and drops the per-file schema. */
function ownerUrl(): string {
  return process.env.TEST_DATABASE_URL as string;
}

/** Runtime role credentials (from DATABASE_URL) pointed at the test database. */
function appUrl(): string {
  const owner = new URL(ownerUrl());
  const app = new URL(process.env.DATABASE_URL ?? ownerUrl());
  app.host = owner.host;
  app.pathname = owner.pathname;
  return app.toString();
}

export const BASE_WORKFLOW = 'config/workflow.yaml';

export interface TestDb {
  schema: string;
  clock: ManualClock;
  /** Connected as claims_app, like the CLI and API. */
  app: AppContext;
  /** Connected as claims_owner, for privileged checks and tampering. */
  owner: pg.Pool;
  /** Another app (e.g. a newer workflow version) on the same schema; closed with the rest. */
  openApp(workflow: CompiledWorkflow): Promise<AppContext>;
  close(): Promise<void>;
}

/** A fresh, migrated and seeded schema in the test database. */
export async function createTestDb(label: string, workflow?: CompiledWorkflow): Promise<TestDb> {
  const schema = `t_${label}_${randomBytes(3).toString('hex')}`;
  await migrateSchema(ownerUrl(), schema);
  await seedSchema(ownerUrl(), schema);
  const clock = new ManualClock();
  const apps: AppContext[] = [];
  const openApp = async (wf: CompiledWorkflow) => {
    const app = await createApp({ databaseUrl: appUrl(), schema, clock, workflow: wf });
    apps.push(app);
    return app;
  };
  const app = await openApp(workflow ?? loadWorkflowFile(BASE_WORKFLOW));
  const owner = createPool(ownerUrl(), schema, 2);
  return {
    schema,
    clock,
    app,
    owner,
    openApp,
    async close() {
      for (const a of apps) await a.close();
      // Audit tables reject TRUNCATE and DELETE, so a clean slate means dropping the schema.
      await owner.query(`DROP SCHEMA ${schema} CASCADE`);
      await owner.end();
    },
  };
}

type Input = Record<string, unknown>;

/** Claim-level helpers over the real service (one minute passes before each action). */
export class Driver {
  constructor(
    readonly db: TestDb,
    readonly app: AppContext = db.app,
  ) {}

  get service() {
    return this.app.service;
  }

  async act(req: ActRequest): Promise<ActResult> {
    this.db.clock.advance(MINUTE);
    return this.service.act(req);
  }

  ok(claim: string | null, transition: string, user: string, input: Input = {}, role?: string) {
    return this.act({
      claim,
      transition_id: transition,
      user_id: user,
      input,
      ...(role ? { role } : {}),
    });
  }

  async fail(
    claim: string | null,
    transition: string,
    user: string,
    input: Input = {},
    role?: string,
  ): Promise<WorkflowError> {
    try {
      await this.ok(claim, transition, user, input, role);
    } catch (error) {
      if (error instanceof WorkflowError) return error;
      throw error;
    }
    throw new Error(`${transition} unexpectedly succeeded`);
  }

  async submit(options: { amount?: number; type?: string; policy?: string; user?: string } = {}) {
    const result = await this.ok(
      null,
      this.service.workflow.creation.id,
      options.user ?? 'u_member_01',
      {
        policy_id: options.policy ?? 'POL-001',
        claim_type: options.type ?? 'outpatient',
        claimed_amount: options.amount ?? 2_500_000,
        treatment_date: '2026-10-15',
      },
    );
    return result.claim.claim_no;
  }

  async attachRequired(claimNo: string, user = 'u_member_01') {
    const claim = await this.service.requireClaim(claimNo);
    const wf = await this.service.workflowFor(this.app.pool, claim);
    for (const doc of wf.definition.document_requirements[claim.claim_type] ?? []) {
      await this.ok(claimNo, 'attach_document', user, {
        document_type: doc,
        file_name: `${doc}.pdf`,
      });
    }
  }

  /** SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT with an assigned assessor. */
  async toAssessment(claimNo: string, assessor = 'u_assessor_01') {
    await this.attachRequired(claimNo);
    await this.ok(claimNo, 'verify_documents', 'u_clerk_01');
    await this.ok(claimNo, 'assign_assessor', 'u_lead_01', { assessor_id: assessor });
    await this.ok(claimNo, 'start_assessment', 'u_lead_01');
  }

  assess(claimNo: string, amount?: number, assessor = 'u_assessor_01') {
    return this.ok(claimNo, 'submit_assessment', assessor, {
      summary: 'Treatment covered; invoices match the prescription.',
      ...(amount !== undefined ? { approved_amount: amount } : {}),
    });
  }

  /** Runs a claim from submission to APPROVED. */
  async approved(amount = 2_000_000) {
    const claimNo = await this.submit();
    await this.toAssessment(claimNo);
    await this.assess(claimNo, amount);
    await this.ok(claimNo, 'approve', 'u_assessor_01');
    return claimNo;
  }

  async states(claimNo: string): Promise<string[]> {
    const { entries } = await this.service.audit(claimNo);
    const states = [entries[0]?.to_state as string];
    for (const e of entries.slice(1)) if (e.from_state !== e.to_state) states.push(e.to_state);
    return states;
  }

  async count(table: string, where = 'true', params: unknown[] = []): Promise<number> {
    const { rows } = await this.db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`,
      params,
    );
    return rows[0]?.n ?? 0;
  }
}
