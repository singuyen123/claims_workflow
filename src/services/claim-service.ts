import { randomUUID } from 'node:crypto';
import type { AuditEntry, ClaimSnapshot } from '../domain/types';
import { evaluateTransition, resolveActor, type TransitionPlan } from '../engine/engine';
import { WorkflowError } from '../engine/errors';
import { hashValue } from '../engine/hash';
import type { IdempotencyRecord } from '../repositories/idempotency-repository';
import type { UnitOfWork } from '../repositories/unit-of-work';
import { buildAuditEntry } from './audit-chain';
import { type Clock, monotonic, systemClock } from './clock';
import type { WorkflowService } from './workflow-service';

export const SYSTEM_USER = 'svc_system';

const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{8,200}$/;

export interface ClaimServiceOptions {
  store: UnitOfWork;
  workflows: WorkflowService;
  auditKey: string;
  clock?: Clock;
  newId?: () => string;
  systemUserId?: string;
  /** Called with a short line whenever an automatic transition runs (CLI output). */
  onAutomatic?: (result: ActResult) => void;
}

export interface ActRequest {
  /** Claim number (CLM-…) or id; omitted for the creation transition. */
  claim?: string | null;
  transition_id: string;
  user_id: string;
  role?: string;
  input?: Record<string, unknown>;
  expected_version?: number;
  idempotency_key?: string;
}

/** A request for the creation transition of the current workflow. */
export type CreateRequest = Omit<ActRequest, 'claim' | 'transition_id'>;

export interface ActResult {
  /** The claim after this action and any automatic transitions it triggered. */
  claim: ClaimSnapshot;
  entry: AuditEntry;
  outbox_ids: number[];
  automatic: ActResult[];
  /** True when the idempotency key matched an earlier identical request. */
  replayed: boolean;
}

interface InternalOptions {
  asSystem?: boolean;
  recordDenied?: boolean;
  autoAdvance?: boolean;
}

type Committed = { plan: TransitionPlan; entry: AuditEntry; outboxIds: number[] };

/** Runs transitions: the only way a claim changes. */
export class ClaimService {
  private readonly clock: Clock;
  private readonly newId: () => string;
  private readonly systemUser: string;

  constructor(private readonly options: ClaimServiceOptions) {
    this.clock = options.clock ?? systemClock;
    this.newId = options.newId ?? randomUUID;
    this.systemUser = options.systemUserId ?? SYSTEM_USER;
  }

  /** Submits a new claim with the current workflow's creation transition. */
  create(req: CreateRequest): Promise<ActResult> {
    return this.act({
      ...req,
      claim: null,
      transition_id: this.options.workflows.current.creation.id,
    });
  }

  /**
   * Runs one transition in a single transaction: lock → idempotency check → evaluate with the
   * claim's pinned definition → update claim + append audit entry + enqueue effects.
   * Refusals are thrown as WorkflowError and recorded in `denied_attempts`. Replays, automatic
   * transitions and the refusal record run after the transaction has released its connection.
   */
  async act(req: ActRequest, internal: InternalOptions = {}): Promise<ActResult> {
    const { store, workflows } = this.options;
    if (req.idempotency_key !== undefined && !IDEMPOTENCY_KEY_RE.test(req.idempotency_key)) {
      throw new WorkflowError(
        'INVALID_INPUT',
        'Idempotency key must be 8–200 printable characters without spaces (a UUID works well)',
      );
    }
    const requestHash = hashValue({
      claim: req.claim ?? null,
      transition_id: req.transition_id,
      role: req.role ?? null,
      input: req.input ?? {},
      expected_version: req.expected_version ?? null,
    });
    // What a refusal is recorded with; filled in as the transaction learns it.
    const attempt: { claim: ClaimSnapshot | null; role: string | null; now: Date } = {
      claim: null,
      role: req.role ?? null,
      now: this.clock.now(),
    };
    let outcome: { replay: IdempotencyRecord } | Committed;
    try {
      outcome = await store.transaction(async (tx) => {
        if (req.idempotency_key) await tx.idempotency.lock(req.idempotency_key);
        let claim: ClaimSnapshot | null = null;
        if (req.claim) {
          // Lock first, then read: concurrent actions on one claim run one after another.
          claim = await tx.claims.find(req.claim, { lock: true });
          if (!claim) {
            throw new WorkflowError('CLAIM_NOT_FOUND', `Claim ${req.claim} not found`, {
              claim_no: req.claim,
            });
          }
          attempt.claim = claim;
          attempt.now = monotonic(attempt.now, claim.updated_at);
        }
        const now = attempt.now;
        if (req.idempotency_key) {
          const prior = await tx.idempotency.find(req.idempotency_key);
          if (prior) {
            if (prior.actor_user_id !== req.user_id || prior.request_hash !== requestHash) {
              throw new WorkflowError(
                'IDEMPOTENCY_KEY_REUSED',
                `Idempotency key '${req.idempotency_key}' was already used for a different request`,
              );
            }
            return { replay: prior };
          }
        }

        const wf = claim
          ? await workflows.get(claim.config_hash, tx.definitions)
          : workflows.current;
        const users = await tx.users.list();
        const getUser = (id: string) => users.find((u) => u.id === id);
        const user = getUser(req.user_id);
        if (user?.service_account && !internal.asSystem) {
          throw new WorkflowError(
            'SERVICE_ACCOUNT_ONLY',
            `${req.user_id} is a service account and cannot be used directly`,
          );
        }
        const actor = resolveActor(wf, user, req.user_id, req.role, req.transition_id);
        attempt.role = actor.role;
        const policyId = claim ? claim.policy_id : req.input?.policy_id;
        const policy = await tx.policies.find(typeof policyId === 'string' ? policyId : undefined);
        const isCreation = !claim && wf.transitions.get(req.transition_id)?.kind === 'create';
        const newClaim = isCreation
          ? { id: this.newId(), claim_no: await tx.claims.nextClaimNo(now.getUTCFullYear()) }
          : undefined;

        const result = evaluateTransition(
          wf,
          claim,
          {
            transition_id: req.transition_id,
            actor,
            input: req.input ?? {},
            ...(req.expected_version !== undefined
              ? { expected_version: req.expected_version }
              : {}),
            ...(newClaim ? { new_claim: newClaim } : {}),
          },
          { policy, getUser },
          { now, newId: this.newId },
        );
        if (!result.ok) throw result.error;
        const plan = result.plan;

        if (claim) {
          if (!(await tx.claims.update(plan.after, claim.version))) {
            throw new WorkflowError(
              'CONCURRENT_MODIFICATION',
              `Claim ${claim.claim_no} changed concurrently`,
            );
          }
        } else {
          await tx.claims.insert(plan.after);
        }
        const head = claim ? await tx.audit.head(claim.id) : null;
        const entry = buildAuditEntry(plan, head, this.options.auditKey);
        await tx.audit.insert(entry);
        const outboxIds = await tx.outbox.enqueue(
          plan.outbox.map((m) => ({
            claim_id: plan.after.id,
            audit_entry_id: entry.entry_id,
            effect_type: m.effect_type,
            payload: m.payload,
            idempotency_key: m.idempotency_key,
            created_at: plan.occurred_at,
          })),
        );
        if (req.idempotency_key) {
          await tx.idempotency.save({
            key: req.idempotency_key,
            actor_user_id: req.user_id,
            request_hash: requestHash,
            claim_id: plan.after.id,
            response: { claim_id: plan.after.id, entry_id: entry.entry_id, outbox_ids: outboxIds },
            created_at: plan.occurred_at,
          });
        }
        if (outboxIds.length) await tx.outbox.notifyWorkers();
        return { plan, entry, outboxIds };
      });
    } catch (error) {
      if (error instanceof WorkflowError && internal.recordDenied !== false) {
        await this.recordRefusal(attempt.claim, req, attempt.role, error, attempt.now);
      }
      throw error;
    }

    if ('replay' in outcome) return this.replay(outcome.replay);
    const { plan, entry, outboxIds } = outcome;
    const automatic = internal.autoAdvance === false ? [] : await this.autoAdvance(plan.after.id);
    return {
      claim: automatic.at(-1)?.claim ?? plan.after,
      entry,
      outbox_ids: outboxIds,
      automatic,
      replayed: false,
    };
  }

  private async replay(prior: IdempotencyRecord): Promise<ActResult> {
    const { repos } = this.options.store;
    const entry = await repos.audit.find(prior.response.entry_id as string);
    const claim = prior.claim_id ? await repos.claims.find(prior.claim_id) : null;
    if (!entry || !claim) throw new Error(`Idempotency record ${prior.key} points to missing data`);
    return {
      claim,
      entry,
      outbox_ids: (prior.response.outbox_ids as number[]) ?? [],
      automatic: [],
      replayed: true,
    };
  }

  private async recordRefusal(
    claim: ClaimSnapshot | null,
    req: ActRequest,
    role: string | null,
    error: WorkflowError,
    now: Date,
  ) {
    try {
      await this.options.store.repos.denied.record({
        claim_id: claim?.id ?? null,
        actor_user_id: req.user_id,
        actor_role: role,
        transition_id: req.transition_id,
        error_code: error.code,
        message: error.message,
        details: error.details as Record<string, unknown>,
        occurred_at: now.toISOString(),
      });
    } catch (recordError) {
      process.emitWarning(`Could not record denied attempt: ${(recordError as Error).message}`);
    }
  }

  /** Runs automatic transitions (as the system service account) while their conditions hold. */
  async autoAdvance(claimId: string): Promise<ActResult[]> {
    const { store, workflows } = this.options;
    const results: ActResult[] = [];
    for (let step = 0; step < 10; step++) {
      const claim = await store.repos.claims.find(claimId);
      if (!claim) break;
      const wf = await workflows.workflowFor(claim);
      const candidates = (wf.outgoing.get(claim.state) ?? []).filter((t) => t.automatic);
      let moved = false;
      for (const t of candidates) {
        const role = t.roles.find((r) => wf.definition.roles[r]?.service_account_only);
        try {
          const result = await this.act(
            {
              claim: claimId,
              transition_id: t.id,
              user_id: this.systemUser,
              ...(role ? { role } : {}),
            },
            { asSystem: true, recordDenied: false, autoAdvance: false },
          );
          results.push(result);
          this.options.onAutomatic?.(result);
          moved = true;
          break;
        } catch (error) {
          if (!(error instanceof WorkflowError)) throw error;
        }
      }
      if (!moved) break;
    }
    return results;
  }

  /** Checks time-based automatic transitions for one claim or every open claim. */
  async runSystem(claimRef?: string): Promise<ActResult[]> {
    const { store, workflows } = this.options;
    if (claimRef) {
      const claim = await store.repos.claims.find(claimRef);
      if (!claim) throw new WorkflowError('CLAIM_NOT_FOUND', `Claim ${claimRef} not found`);
      return this.autoAdvance(claim.id);
    }
    const results: ActResult[] = [];
    for (const claim of await store.repos.claims.list({ limit: 1000 })) {
      const wf = await workflows.workflowFor(claim);
      if (wf.isTerminal(claim.state)) continue;
      results.push(...(await this.autoAdvance(claim.id)));
    }
    return results;
  }
}
