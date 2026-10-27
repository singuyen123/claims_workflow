import type { ClaimSnapshot } from '../../src/domain/types';
import {
  availableTransitions,
  type CompiledWorkflow,
  type EvaluateResult,
  evaluateTransition,
  loadWorkflowFile,
  resolveActor,
  type TransitionPlan,
  WorkflowError,
} from '../../src/engine';
import { loadSeed } from '../../src/infra/seed-file';

export const BASE_CONFIG = 'config/workflow.yaml';

interface RunOptions {
  role?: string;
  expectedVersion?: number;
}

/**
 * Drives the pure engine with an in-memory claim store. Mirrors what the application service
 * does (resolve actor → evaluate → apply plan → run automatic transitions) without a database.
 */
export class EngineHarness {
  readonly wf: CompiledWorkflow;
  readonly seed = loadSeed();
  readonly claims = new Map<string, ClaimSnapshot>();
  readonly audit: TransitionPlan[] = [];
  now = new Date('2026-10-20T03:00:00.000Z');
  private ids = 0;
  private claimSeq = 0;

  constructor(wf?: CompiledWorkflow) {
    this.wf = wf ?? loadWorkflowFile(BASE_CONFIG);
  }

  newId = () => `00000000-0000-4000-8000-${String(++this.ids).padStart(12, '0')}`;

  advance(ms = 60_000) {
    this.now = new Date(this.now.getTime() + ms);
  }

  getUser = (id: string) => this.seed.users.find((u) => u.id === id);

  policy(id: string | undefined) {
    return this.seed.policies.find((p) => p.id === id) ?? null;
  }

  claim(claimNo: string): ClaimSnapshot {
    const claim = this.claims.get(claimNo);
    if (!claim) throw new Error(`no claim ${claimNo}`);
    return claim;
  }

  run(
    claimNo: string | null,
    transitionId: string,
    userId: string,
    input: Record<string, unknown> = {},
    options: RunOptions = {},
  ): EvaluateResult {
    this.advance();
    const claim = claimNo ? (this.claims.get(claimNo) ?? null) : null;
    let actor: ReturnType<typeof resolveActor>;
    try {
      actor = resolveActor(this.wf, this.getUser(userId), userId, options.role, transitionId);
    } catch (error) {
      if (error instanceof WorkflowError) return { ok: false, error };
      throw error;
    }
    const policyId = claim ? claim.policy_id : (input.policy_id as string | undefined);
    const result = evaluateTransition(
      this.wf,
      claim,
      {
        transition_id: transitionId,
        actor,
        input,
        ...(options.expectedVersion !== undefined
          ? { expected_version: options.expectedVersion }
          : {}),
        ...(claim
          ? {}
          : {
              new_claim: {
                id: this.newId(),
                claim_no: `CLM-2026-${String(++this.claimSeq).padStart(6, '0')}`,
              },
            }),
      },
      { policy: this.policy(policyId), getUser: this.getUser },
      { now: this.now, newId: this.newId },
    );
    if (result.ok) {
      this.apply(result.plan);
      this.autoAdvance(result.plan.after.claim_no);
    }
    return result;
  }

  private apply(plan: TransitionPlan) {
    this.claims.set(plan.after.claim_no, plan.after);
    this.audit.push(plan);
  }

  /** Runs automatic transitions (as the system service account) while their conditions hold. */
  autoAdvance(claimNo: string) {
    for (let i = 0; i < 10; i++) {
      const claim = this.claims.get(claimNo);
      if (!claim) return;
      const auto = (this.wf.outgoing.get(claim.state) ?? []).filter((t) => t.automatic);
      let moved = false;
      for (const t of auto) {
        const actor = resolveActor(this.wf, this.getUser('svc_system'), 'svc_system', 'system');
        const result = evaluateTransition(
          this.wf,
          claim,
          { transition_id: t.id, actor },
          { policy: this.policy(claim.policy_id), getUser: this.getUser },
          { now: this.now, newId: this.newId },
        );
        if (result.ok) {
          this.apply(result.plan);
          moved = true;
          break;
        }
      }
      if (!moved) return;
    }
  }

  ok(
    claimNo: string | null,
    transitionId: string,
    userId: string,
    input: Record<string, unknown> = {},
    options: RunOptions = {},
  ): TransitionPlan {
    const result = this.run(claimNo, transitionId, userId, input, options);
    if (!result.ok) {
      throw new Error(`${transitionId} refused: ${result.error.code}: ${result.error.message}`);
    }
    return result.plan;
  }

  fail(
    claimNo: string | null,
    transitionId: string,
    userId: string,
    input: Record<string, unknown> = {},
    options: RunOptions = {},
  ): WorkflowError {
    const result = this.run(claimNo, transitionId, userId, input, options);
    if (result.ok) throw new Error(`${transitionId} unexpectedly succeeded`);
    return result.error;
  }

  available(claimNo: string, userId: string, role?: string) {
    const claim = this.claim(claimNo);
    const actor = resolveActor(this.wf, this.getUser(userId), userId, role);
    return availableTransitions(
      this.wf,
      claim,
      actor,
      { policy: this.policy(claim.policy_id), getUser: this.getUser },
      { now: this.now, newId: this.newId },
    );
  }

  /** State history (state-changing entries only). */
  states(claimNo: string): string[] {
    const entries = this.audit.filter((p) => p.after.claim_no === claimNo);
    const states = [entries[0]?.to_state as string];
    for (const p of entries.slice(1)) if (p.from_state !== p.to_state) states.push(p.to_state);
    return states;
  }

  // ── scenario building blocks ───────────────────────────────────────────────────────────────

  submit(
    options: {
      amount?: number;
      type?: 'outpatient' | 'inpatient';
      policy?: string;
      user?: string;
    } = {},
  ): string {
    const plan = this.ok(null, 'submit_claim', options.user ?? 'u_member_01', {
      policy_id: options.policy ?? 'POL-001',
      claim_type: options.type ?? 'outpatient',
      claimed_amount: options.amount ?? 2_500_000,
      treatment_date: '2026-10-15',
    });
    return plan.after.claim_no;
  }

  attachRequired(claimNo: string, user = 'u_member_01') {
    const claimType = this.claim(claimNo).claim_type;
    for (const doc of this.wf.definition.document_requirements[claimType] ?? []) {
      this.ok(claimNo, 'attach_document', user, { document_type: doc, file_name: `${doc}.pdf` });
    }
  }

  /** SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT with an assigned assessor. */
  toAssessment(claimNo: string, assessor = 'u_assessor_01', clerk = 'u_clerk_01') {
    this.attachRequired(claimNo);
    this.ok(claimNo, 'verify_documents', clerk);
    this.ok(claimNo, 'assign_assessor', 'u_lead_01', { assessor_id: assessor });
    this.ok(claimNo, 'start_assessment', 'u_lead_01');
  }

  assess(claimNo: string, amount: number | undefined, assessor = 'u_assessor_01') {
    this.ok(claimNo, 'submit_assessment', assessor, {
      summary: 'Treatment covered; invoices match the prescription.',
      ...(amount !== undefined ? { approved_amount: amount } : {}),
    });
  }
}
