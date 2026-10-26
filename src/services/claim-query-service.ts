import { randomUUID } from 'node:crypto';
import type {
  AuditEntry,
  ClaimFilter,
  ClaimSnapshot,
  DeniedAttempt,
  Policy,
} from '../domain/types';
import { type AvailableTransition, availableTransitions, resolveActor } from '../engine/engine';
import { WorkflowError } from '../engine/errors';
import { type CompiledWorkflow, ConfigError } from '../engine/load';
import { toMermaid } from '../engine/mermaid';
import type { ClaimRepository } from '../repositories/claim-repository';
import type { Repositories } from '../repositories/unit-of-work';
import { type Clock, monotonic, systemClock } from './clock';
import { type VerifyReport, verifyClaimChain } from './verify';
import type { WorkflowService } from './workflow-service';

export interface ClaimQueryOptions {
  repos: Repositories;
  workflows: WorkflowService;
  auditKey: string;
  clock?: Clock;
  /** Same generator as the ClaimService: dry runs draw from it like real runs. */
  newId?: () => string;
}

/** The user a query is evaluated for. */
export interface ActorRef {
  user_id: string;
  role?: string;
}

export interface ClaimListQuery extends ClaimFilter {
  /** Only claims this user can act on now, each with the transitions they can run. */
  queue_for?: ActorRef;
}

export type ClaimListItem = ClaimSnapshot & { can_run?: string[] };

export interface AvailableResult {
  claim: ClaimSnapshot;
  roles: string[];
  transitions: Array<AvailableTransition & { acting_role: string }>;
}

/** Finds a claim by number or id, or refuses with CLAIM_NOT_FOUND. */
export async function requireClaim(claims: ClaimRepository, ref: string): Promise<ClaimSnapshot> {
  const claim = await claims.find(ref);
  if (!claim)
    throw new WorkflowError('CLAIM_NOT_FOUND', `Claim ${ref} not found`, { claim_no: ref });
  return claim;
}

/** Read side of claims: lists, work queues, what a user may do next, audit trail, integrity. */
export class ClaimQueryService {
  private readonly repos: Repositories;
  private readonly workflows: WorkflowService;
  private readonly clock: Clock;
  private readonly newId: () => string;

  constructor(private readonly options: ClaimQueryOptions) {
    this.repos = options.repos;
    this.workflows = options.workflows;
    this.clock = options.clock ?? systemClock;
    this.newId = options.newId ?? randomUUID;
  }

  getClaim(ref: string): Promise<ClaimSnapshot | null> {
    return this.repos.claims.find(ref);
  }

  requireClaim(ref: string): Promise<ClaimSnapshot> {
    return requireClaim(this.repos.claims, ref);
  }

  async listClaims(query: ClaimListQuery = {}): Promise<ClaimListItem[]> {
    const { queue_for: who, ...filter } = query;
    const claims = await this.repos.claims.list(filter);
    if (!who) return claims;
    const queued: ClaimListItem[] = [];
    for (const claim of claims) {
      const { transitions } = await this.available(claim.id, who.user_id, who.role);
      const ready = transitions.filter((t) => t.allowed && !t.automatic).map((t) => t.id);
      if (ready.length) queued.push({ ...claim, can_run: ready });
    }
    return queued;
  }

  /**
   * Dry-run of the transitions available to a user. Users holding several roles get, for each
   * transition, the result for the first of their roles that is allowed to run it.
   */
  async available(claimRef: string, userId: string, role?: string): Promise<AvailableResult> {
    const claim = await this.requireClaim(claimRef);
    const wf = await this.workflows.workflowFor(claim);
    const users = await this.repos.users.list();
    const getUser = (id: string) => users.find((u) => u.id === id);
    const user = getUser(userId);
    if (!user) throw new WorkflowError('UNKNOWN_USER', `Unknown user '${userId}'`);
    const roles = role ? [role] : user.roles;
    const policy = await this.repos.policies.find(claim.policy_id);
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

  /** A claim with its pinned definition, its policy and, with `userId`, what that user can do. */
  async inspect(
    claimRef: string,
    userId?: string,
    role?: string,
  ): Promise<{
    claim: ClaimSnapshot;
    workflow: CompiledWorkflow;
    policy: Policy | null;
    available: AvailableResult | undefined;
  }> {
    const claim = await this.requireClaim(claimRef);
    const workflow = await this.workflows.workflowFor(claim);
    const available = userId ? await this.available(claim.id, userId, role) : undefined;
    const policy = await this.repos.policies.find(claim.policy_id);
    return { claim, workflow, policy, available };
  }

  /** Everything the claim page of the web UI shows, in one response. */
  async detail(claimRef: string, who?: ActorRef) {
    const claim = await this.requireClaim(claimRef);
    const wf = await this.workflows.workflowFor(claim);
    const entries = await this.repos.audit.list(claim.id);
    const available = who ? await this.available(claim.id, who.user_id, who.role) : undefined;
    return {
      claim,
      policy: await this.repos.policies.find(claim.policy_id),
      workflow: this.workflows.describe(wf),
      diagram: toMermaid(wf, { current: claim.state, visited: entries.map((e) => e.to_state) }),
      ...(available
        ? {
            acting: { user_id: who?.user_id, roles: available.roles },
            available: available.transitions,
          }
        : {}),
    };
  }

  /** Mermaid diagram of the claim's pinned definition, highlighting where it is and has been. */
  async diagram(claimRef: string, options: { roles?: boolean } = {}): Promise<string> {
    const { claim, entries } = await this.audit(claimRef);
    const wf = await this.workflows.workflowFor(claim);
    return toMermaid(wf, {
      current: claim.state,
      visited: entries.map((e) => e.to_state),
      ...options,
    });
  }

  // ── audit trail and integrity ──────────────────────────────────────────────────────────────

  async audit(claimRef: string): Promise<{ claim: ClaimSnapshot; entries: AuditEntry[] }> {
    const claim = await this.requireClaim(claimRef);
    return { claim, entries: await this.repos.audit.list(claim.id) };
  }

  /** The audit trail; `stateChangesOnly` hides in-state actions. */
  async auditEntries(
    claimRef: string,
    options: { stateChangesOnly?: boolean } = {},
  ): Promise<AuditEntry[]> {
    const { entries } = await this.audit(claimRef);
    return options.stateChangesOnly ? entries.filter((e) => e.from_state !== e.to_state) : entries;
  }

  async denied(claimRef?: string): Promise<DeniedAttempt[]> {
    if (!claimRef) return this.repos.denied.list();
    const claim = await this.requireClaim(claimRef);
    return this.repos.denied.list(claim.id);
  }

  /** Verifies the audit chain, the replay, the claim row and every definition involved. */
  async verify(claimRef: string): Promise<VerifyReport> {
    const { claim, entries } = await this.audit(claimRef);
    const report = verifyClaimChain(claim, entries, this.options.auditKey);
    const hashes = new Set([claim.config_hash, ...entries.map((e) => e.config_hash)]);
    for (const hash of hashes) {
      try {
        await this.workflows.loadStored(hash);
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
    const claims = await this.repos.claims.list({ limit: 10_000 });
    const reports: VerifyReport[] = [];
    for (const c of claims) reports.push(await this.verify(c.id));
    return reports;
  }

  /** One claim's report, or every claim's when no claim is given. */
  async verifyClaims(claimRef?: string): Promise<VerifyReport[]> {
    return claimRef ? [await this.verify(claimRef)] : this.verifyAll();
  }
}
