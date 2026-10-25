import type { AppContext } from '../app/bootstrap';
import type { ActResult } from '../app/claim-service';
import { type ManualClock, MINUTE } from '../app/clock';
import type { VerifyReport } from '../app/verify';
import type { ClaimSnapshot } from '../domain/types';
import { type Failure, WorkflowError } from '../engine/errors';

export type StepKind = 'action' | 'available' | 'system' | 'verify' | 'note';

export interface StepRecord {
  kind: StepKind;
  at: string;
  actor?: string;
  role?: string;
  claim?: string;
  transition?: string;
  input?: Record<string, unknown>;
  /** 'ok' or the expected error code. */
  expected?: string;
  /** The step went as expected. */
  ok: boolean;
  outcome: string;
  error?: { code: string; message: string; failures?: Failure[] };
  /** Lines logged by the outbox worker while delivering this step's side effects. */
  effects: string[];
  /** Automatic transitions the step triggered. */
  automatic: string[];
  /** Rows for an `available` step: transition, target, roles, status. */
  rows?: string[][];
}

export interface CheckRecord {
  label: string;
  ok: boolean;
  detail?: string;
}

interface ActOptions {
  role?: string;
  /** Idempotency key. */
  key?: string;
  /** Expected error code; omitted when the action must succeed. */
  expect?: string;
}

type Input = Record<string, unknown>;

export interface ScenarioEnv {
  base: AppContext;
  /** Opens the app running the extended workflow (registers its definition on first use). */
  extension: () => Promise<AppContext>;
  clock: ManualClock;
  /** Runs the outbox worker until nothing is due; returns what it logged. */
  deliver: () => Promise<string[]>;
}

/** Records one scenario: every action, the side effects it produced, and explicit checks. */
export class ScenarioRun {
  readonly steps: StepRecord[] = [];
  readonly checks: CheckRecord[] = [];
  /** Claim numbers in the order they were created. */
  readonly claims: string[] = [];
  private current: AppContext;
  private readonly clock: ManualClock;
  private readonly deliver: () => Promise<string[]>;

  constructor(private readonly env: ScenarioEnv) {
    this.current = env.base;
    this.clock = env.clock;
    this.deliver = env.deliver;
  }

  get app(): AppContext {
    return this.current;
  }

  get service() {
    return this.current.service;
  }

  /** Switches new claims to the extended workflow; existing claims keep their pinned version. */
  async switchToExtension(): Promise<void> {
    this.current = await this.env.extension();
    const wf = this.current.workflow;
    this.note(
      `Started the app with ${wf.id} v${wf.version} (config hash ${wf.hash.slice(0, 12)}…): new claims use it.`,
    );
  }

  get passed(): boolean {
    return this.steps.every((s) => s.ok) && this.checks.every((c) => c.ok);
  }

  private now(): string {
    return this.clock.now().toISOString();
  }

  /** Runs a transition one simulated minute after the previous step. */
  async act(
    claim: string | null,
    transition: string,
    user: string,
    input: Input = {},
    options: ActOptions = {},
  ): Promise<ActResult | undefined> {
    this.clock.advance(MINUTE);
    const expected = options.expect ?? 'ok';
    const step: StepRecord = {
      kind: 'action',
      at: this.now(),
      actor: user,
      transition,
      input,
      expected,
      ok: false,
      outcome: '',
      effects: [],
      automatic: [],
      ...(options.role ? { role: options.role } : {}),
      ...(claim ? { claim } : {}),
    };
    try {
      const result = await this.service.act({
        claim,
        transition_id: transition,
        user_id: user,
        input,
        ...(options.role ? { role: options.role } : {}),
        ...(options.key ? { idempotency_key: options.key } : {}),
      });
      const e = result.entry;
      step.at = e.occurred_at;
      step.claim = result.claim.claim_no;
      step.role = e.actor_role;
      if (!this.claims.includes(result.claim.claim_no)) this.claims.push(result.claim.claim_no);
      step.outcome =
        e.from_state === null
          ? `new → ${e.to_state}`
          : e.from_state === e.to_state
            ? `${e.to_state} (no state change)`
            : `${e.from_state} → ${e.to_state}`;
      if (result.replayed)
        step.outcome += ' — replayed for the same idempotency key, nothing re-executed';
      step.automatic = result.automatic.map(
        (a) =>
          `${a.entry.transition_id}: ${a.entry.from_state} → ${a.entry.to_state} by ${a.entry.actor_user_id} (${a.entry.actor_role})`,
      );
      step.ok = expected === 'ok';
      step.effects = await this.deliver();
      return result;
    } catch (error) {
      if (!(error instanceof WorkflowError)) throw error;
      step.error = {
        code: error.code,
        message: error.message,
        ...(error.details.failures ? { failures: error.details.failures } : {}),
      };
      step.outcome = `refused: ${error.code}`;
      step.ok = expected === error.code;
      return undefined;
    } finally {
      if (!step.ok && !step.outcome.startsWith('refused'))
        step.outcome += ` (expected ${expected})`;
      this.steps.push(step);
    }
  }

  /** Records what `user` may do on the claim right now (the "available transitions" view). */
  async available(claimNo: string, user: string): Promise<void> {
    const { transitions } = await this.service.available(claimNo, user);
    this.steps.push({
      kind: 'available',
      at: this.now(),
      actor: user,
      claim: claimNo,
      ok: true,
      outcome: `${transitions.filter((t) => t.allowed).length} of ${transitions.length} transitions available to ${user}`,
      effects: [],
      automatic: [],
      rows: transitions.map((t) => [
        t.id,
        t.to ?? '(same state)',
        t.roles.join(', '),
        t.allowed
          ? `✓ as ${t.acting_role}${
              t.inputs.some((i) => i.required)
                ? `, needs ${t.inputs
                    .filter((i) => i.required)
                    .map((i) => i.name)
                    .join(', ')}`
                : ''
            }`
          : `✗ ${t.checks.find((c) => !c.ok)?.message ?? 'not allowed'}`,
      ]),
    });
  }

  note(text: string): void {
    this.steps.push({
      kind: 'note',
      at: this.now(),
      ok: true,
      outcome: text,
      effects: [],
      automatic: [],
    });
  }

  /** Moves the simulated clock forward. */
  later(ms: number, text: string): void {
    this.clock.advance(ms);
    this.note(text);
  }

  /** Runs the scheduler pass that fires time-based automatic transitions. */
  async system(claimNo?: string): Promise<ActResult[]> {
    const results = await this.service.runSystem(claimNo);
    const effects = await this.deliver();
    this.steps.push({
      kind: 'system',
      at: this.now(),
      actor: 'svc_system',
      ok: true,
      outcome: results.length ? `${results.length} automatic transition(s)` : 'nothing due',
      effects,
      automatic: results.map(
        (r) =>
          `${r.claim.claim_no} ${r.entry.transition_id}: ${r.entry.from_state} → ${r.entry.to_state}`,
      ),
      ...(claimNo ? { claim: claimNo } : {}),
    });
    return results;
  }

  async verify(claimNo: string): Promise<VerifyReport> {
    const report = await this.service.verify(claimNo);
    this.steps.push({
      kind: 'verify',
      at: this.now(),
      claim: claimNo,
      ok: report.ok,
      outcome: report.ok
        ? `audit chain intact: ${report.entries} entries, replay matches, claim row matches the last entry`
        : `integrity check failed: ${report.issues.map((i) => i.code).join(', ')}`,
      effects: [],
      automatic: [],
    });
    return report;
  }

  check(label: string, ok: boolean, detail?: string): void {
    this.checks.push({ label, ok, ...(detail !== undefined ? { detail } : {}) });
  }

  claim(claimNo: string): Promise<ClaimSnapshot> {
    return this.service.requireClaim(claimNo);
  }

  /** The error of the most recent refused step. */
  lastError(): StepRecord['error'] {
    return [...this.steps].reverse().find((s) => s.error)?.error;
  }

  // ── building blocks ────────────────────────────────────────────────────────────────────────

  async submit(
    options: { amount?: number; type?: string; policy?: string; user?: string } = {},
  ): Promise<string> {
    const result = await this.act(
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
    if (!result) throw new Error('claim submission failed');
    return result.claim.claim_no;
  }

  async attachRequired(claimNo: string, user = 'u_member_01'): Promise<void> {
    const claim = await this.claim(claimNo);
    const wf = await this.service.workflowFor(this.app.pool, claim);
    for (const doc of wf.definition.document_requirements[claim.claim_type] ?? []) {
      await this.act(claimNo, 'attach_document', user, {
        document_type: doc,
        file_name: `${doc}.pdf`,
      });
    }
  }

  async toAssessment(
    claimNo: string,
    assessor = 'u_assessor_01',
    clerk = 'u_clerk_01',
  ): Promise<void> {
    await this.attachRequired(claimNo);
    await this.act(claimNo, 'verify_documents', clerk);
    await this.act(claimNo, 'assign_assessor', 'u_lead_01', { assessor_id: assessor });
    await this.act(claimNo, 'start_assessment', 'u_lead_01');
  }

  async assess(claimNo: string, amount?: number, assessor = 'u_assessor_01'): Promise<void> {
    await this.act(claimNo, 'submit_assessment', assessor, {
      summary: 'Treatment and invoices reviewed; covered under the outpatient benefit.',
      ...(amount !== undefined ? { approved_amount: amount } : {}),
    });
  }

  async pay(claimNo: string, finance = 'u_finance_01'): Promise<void> {
    await this.act(claimNo, 'initiate_payment', finance);
    await this.act(claimNo, 'confirm_payment', finance, {
      payment_reference: `VCB-${claimNo.slice(-6)}`,
    });
    await this.act(claimNo, 'close_paid', finance, { notes: 'Payment confirmed by the bank' });
  }

  async expectState(claimNo: string, state: string): Promise<void> {
    const claim = await this.claim(claimNo);
    this.check(`${claimNo} ends in ${state}`, claim.state === state, `state is ${claim.state}`);
  }

  async expectPath(claimNo: string, states: string[]): Promise<void> {
    const { entries } = await this.service.audit(claimNo);
    const path = [entries[0]?.to_state ?? '?'];
    for (const e of entries.slice(1)) if (e.from_state !== e.to_state) path.push(e.to_state);
    this.check(
      `${claimNo} went through ${states.join(' → ')}`,
      path.join('>') === states.join('>'),
      `actual path: ${path.join(' → ')}`,
    );
  }
}
