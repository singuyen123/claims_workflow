import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AuditEntry, ClaimSnapshot, DeniedAttempt, User } from '../domain/types';
import {
  type AvailableTransition,
  availableTransitions,
  evaluateTransition,
  resolveActor,
} from '../engine/engine';
import { WorkflowError } from '../engine/errors';
import { hashValue } from '../engine/hash';
import { type CompiledWorkflow, ConfigError } from '../engine/load';
import type { Db } from '../infra/db/pool';
import { OUTBOX_CHANNEL } from '../infra/outbox/channel';
import {
  chainHead,
  findEntry,
  insertEntry,
  listDenied,
  listEntries,
  recordDenied,
} from '../infra/repos/audit';
import {
  type ClaimFilter,
  findClaim,
  insertClaim,
  listClaims,
  nextClaimNo,
  updateClaim,
} from '../infra/repos/claims';
import { enqueue } from '../infra/repos/outbox';
import {
  findIdempotency,
  findPolicy,
  type IdempotencyRecord,
  loadUsers,
  saveIdempotency,
} from '../infra/repos/reference';
import { buildAuditEntry } from './audit-chain';
import { type Clock, monotonic, systemClock } from './clock';
import type { DefinitionRegistry } from './definition-registry';
import { type VerifyReport, verifyClaimChain } from './verify';

export const SYSTEM_USER = 'svc_system';

const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{8,200}$/;

export interface ServiceOptions {
  pool: pg.Pool;
  registry: DefinitionRegistry;
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

export class ClaimService {
  private readonly clock: Clock;
  private readonly newId: () => string;
  private readonly systemUser: string;

  constructor(private readonly options: ServiceOptions) {
    this.clock = options.clock ?? systemClock;
    this.newId = options.newId ?? randomUUID;
    this.systemUser = options.systemUserId ?? SYSTEM_USER;
  }

  get workflow(): CompiledWorkflow {
    return this.options.registry.current;
  }

  get pool(): pg.Pool {
    return this.options.pool;
  }

  /** Registers the current workflow definition (call once at startup). */
  async init(): Promise<void> {
    await this.options.registry.registerCurrent(this.options.pool, this.clock.now());
  }

  workflowFor(db: Db, claim: ClaimSnapshot): Promise<CompiledWorkflow> {
    return this.options.registry.get(db, claim.config_hash);
  }

  /**
   * Runs one transition in a single transaction: lock → idempotency check → evaluate with the
   * claim's pinned definition → update claim + append audit entry + enqueue effects.
   * Refusals are thrown as WorkflowError and recorded in `denied_attempts`.
   */
  async act(req: ActRequest, internal: InternalOptions = {}): Promise<ActResult> {
    const { pool, registry } = this.options;
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
    let claim: ClaimSnapshot | null = null;
    let actingRole: string | null = req.role ?? null;
    let now = this.clock.now();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (req.idempotency_key) {
        // Serialises requests that share a key (including creations, which have no row to lock).
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          req.idempotency_key,
        ]);
      }
      if (req.claim) {
        // Lock first, then read: concurrent actions on one claim run one after another.
        claim = await findClaim(client, req.claim, { lock: true });
        if (!claim) {
          throw new WorkflowError('CLAIM_NOT_FOUND', `Claim ${req.claim} not found`, {
            claim_no: req.claim,
          });
        }
        now = monotonic(now, claim.updated_at);
      }
      if (req.idempotency_key) {
        const prior = await findIdempotency(client, req.idempotency_key);
        if (prior) {
          if (prior.actor_user_id !== req.user_id || prior.request_hash !== requestHash) {
            throw new WorkflowError(
              'IDEMPOTENCY_KEY_REUSED',
              `Idempotency key '${req.idempotency_key}' was already used for a different request`,
            );
          }
          await client.query('COMMIT');
          return await this.replay(prior);
        }
      }

      const wf = claim ? await registry.get(client, claim.config_hash) : registry.current;
      const users = await loadUsers(client);
      const getUser = (id: string) => users.find((u) => u.id === id);
      const user = getUser(req.user_id);
      if (user?.service_account && !internal.asSystem) {
        throw new WorkflowError(
          'SERVICE_ACCOUNT_ONLY',
          `${req.user_id} is a service account and cannot be used directly`,
        );
      }
      const actor = resolveActor(wf, user, req.user_id, req.role, req.transition_id);
      actingRole = actor.role;
      const policyId = claim ? claim.policy_id : req.input?.policy_id;
      const policy = await findPolicy(client, typeof policyId === 'string' ? policyId : undefined);
      const isCreation = !claim && wf.transitions.get(req.transition_id)?.kind === 'create';
      const newClaim = isCreation
        ? { id: this.newId(), claim_no: await nextClaimNo(client, now.getUTCFullYear()) }
        : undefined;

      const result = evaluateTransition(
        wf,
        claim,
        {
          transition_id: req.transition_id,
          actor,
          input: req.input ?? {},
          ...(req.expected_version !== undefined ? { expected_version: req.expected_version } : {}),
          ...(newClaim ? { new_claim: newClaim } : {}),
        },
        { policy, getUser },
        { now, newId: this.newId },
      );
      if (!result.ok) throw result.error;
      const plan = result.plan;

      if (claim) {
        if (!(await updateClaim(client, plan.after, claim.version))) {
          throw new WorkflowError(
            'CONCURRENT_MODIFICATION',
            `Claim ${claim.claim_no} changed concurrently`,
          );
        }
      } else {
        await insertClaim(client, plan.after);
      }
      const head = claim ? await chainHead(client, claim.id) : null;
      const entry = buildAuditEntry(plan, head, this.options.auditKey);
      await insertEntry(client, entry);
      const outboxIds = await enqueue(
        client,
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
        await saveIdempotency(client, {
          key: req.idempotency_key,
          actor_user_id: req.user_id,
          request_hash: requestHash,
          claim_id: plan.after.id,
          response: { claim_id: plan.after.id, entry_id: entry.entry_id, outbox_ids: outboxIds },
          created_at: plan.occurred_at,
        });
      }
      if (outboxIds.length) {
        await client.query('SELECT pg_notify($1, current_schema())', [OUTBOX_CHANNEL]);
      }
      await client.query('COMMIT');

      const automatic = internal.autoAdvance === false ? [] : await this.autoAdvance(plan.after.id);
      return {
        claim: automatic.at(-1)?.claim ?? plan.after,
        entry,
        outbox_ids: outboxIds,
        automatic,
        replayed: false,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof WorkflowError && internal.recordDenied !== false) {
        await this.recordRefusal(claim, req, actingRole, error, now);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async replay(prior: IdempotencyRecord): Promise<ActResult> {
    const entry = await findEntry(this.options.pool, prior.response.entry_id as string);
    const claim = prior.claim_id ? await findClaim(this.options.pool, prior.claim_id) : null;
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
      await recordDenied(this.options.pool, {
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
    const results: ActResult[] = [];
    for (let step = 0; step < 10; step++) {
      const claim = await findClaim(this.options.pool, claimId);
      if (!claim) break;
      const wf = await this.workflowFor(this.options.pool, claim);
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
    if (claimRef) {
      const claim = await this.getClaim(claimRef);
      if (!claim) throw new WorkflowError('CLAIM_NOT_FOUND', `Claim ${claimRef} not found`);
      return this.autoAdvance(claim.id);
    }
    const results: ActResult[] = [];
    for (const claim of await listClaims(this.options.pool, { limit: 1000 })) {
      const wf = await this.workflowFor(this.options.pool, claim);
      if (wf.isTerminal(claim.state)) continue;
      results.push(...(await this.autoAdvance(claim.id)));
    }
    return results;
  }

  // ── queries ────────────────────────────────────────────────────────────────────────────────

  getClaim(ref: string): Promise<ClaimSnapshot | null> {
    return findClaim(this.options.pool, ref);
  }

  async requireClaim(ref: string): Promise<ClaimSnapshot> {
    const claim = await this.getClaim(ref);
    if (!claim)
      throw new WorkflowError('CLAIM_NOT_FOUND', `Claim ${ref} not found`, { claim_no: ref });
    return claim;
  }

  listClaims(filter: ClaimFilter = {}): Promise<ClaimSnapshot[]> {
    return listClaims(this.options.pool, filter);
  }

  users(): Promise<User[]> {
    return loadUsers(this.options.pool);
  }

  /**
   * Dry-run of the transitions available to a user. Users holding several roles get, for each
   * transition, the result for the first of their roles that is allowed to run it.
   */
  async available(
    claimRef: string,
    userId: string,
    role?: string,
  ): Promise<{
    claim: ClaimSnapshot;
    roles: string[];
    transitions: Array<AvailableTransition & { acting_role: string }>;
  }> {
    const claim = await this.requireClaim(claimRef);
    const wf = await this.workflowFor(this.options.pool, claim);
    const users = await loadUsers(this.options.pool);
    const getUser = (id: string) => users.find((u) => u.id === id);
    const user = getUser(userId);
    if (!user) throw new WorkflowError('UNKNOWN_USER', `Unknown user '${userId}'`);
    const roles = role ? [role] : user.roles;
    const policy = await findPolicy(this.options.pool, claim.policy_id);
    const env = { now: monotonic(this.clock.now(), claim.updated_at), newId: this.newId };
    const perRole = roles.map((r) => ({
      role: r,
      list: availableTransitions(
        wf,
        claim,
        resolveActor(wf, user, userId, r),
        { policy, getUser },
        env,
      ),
    }));
    const first = perRole[0]?.list ?? [];
    const transitions = first.map((t, i) => {
      const options = perRole.map((p) => ({ role: p.role, t: p.list[i] as AvailableTransition }));
      const best =
        options.find((o) => o.t.allowed) ?? options.find((o) => o.t.role_ok) ?? options[0];
      return { ...(best?.t ?? t), acting_role: best?.role ?? roles[0] ?? '' };
    });
    return { claim, roles, transitions };
  }

  async audit(claimRef: string): Promise<{ claim: ClaimSnapshot; entries: AuditEntry[] }> {
    const claim = await this.requireClaim(claimRef);
    return { claim, entries: await listEntries(this.options.pool, claim.id) };
  }

  async denied(claimRef?: string): Promise<DeniedAttempt[]> {
    if (!claimRef) return listDenied(this.options.pool);
    const claim = await this.requireClaim(claimRef);
    return listDenied(this.options.pool, claim.id);
  }

  /** Verifies the audit chain, the replay, the claim row and every definition involved. */
  async verify(claimRef: string): Promise<VerifyReport> {
    const { claim, entries } = await this.audit(claimRef);
    const report = verifyClaimChain(claim, entries, this.options.auditKey);
    const hashes = new Set([claim.config_hash, ...entries.map((e) => e.config_hash)]);
    for (const hash of hashes) {
      try {
        await this.options.registry.loadStored(this.options.pool, hash);
      } catch (error) {
        const message =
          error instanceof ConfigError
            ? error.issues.map((i) => i.message).join('; ')
            : String(error);
        report.issues.push({
          code: 'DEFINITION_TAMPERED',
          message: `Definition ${hash.slice(0, 12)}…: ${message}`,
        });
      }
    }
    report.ok = report.issues.length === 0;
    return report;
  }

  async verifyAll(): Promise<VerifyReport[]> {
    const claims = await listClaims(this.options.pool, { limit: 10_000 });
    const reports: VerifyReport[] = [];
    for (const c of claims) reports.push(await this.verify(c.id));
    return reports;
  }
}
