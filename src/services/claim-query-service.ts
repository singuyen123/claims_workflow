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
import type { Repositories, UnitOfWork } from '../repositories/unit-of-work';
import { ReadAccess, type Viewer } from './access';
import { eachClaim } from './claim-pages';
import { type Clock, monotonic, systemClock } from './clock';
import { type VerifyReport, verifyClaimChain, verifyOutbox } from './verify';
import type { WorkflowService } from './workflow-service';

export interface ClaimQueryOptions {
  store: UnitOfWork;
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
  /** Only claims this user may see (see ReadAccess); omitted for local operator tools. */
  viewer?: Viewer;
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
  private readonly access: ReadAccess;

  constructor(private readonly options: ClaimQueryOptions) {
    this.repos = options.store.repos;
    this.access = new ReadAccess(this.repos.users);
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

  /** A claim the viewer may see; any other is refused as not found. */
  private async readableClaim(ref: string, viewer: Viewer | undefined): Promise<ClaimSnapshot> {
    const claim = await this.requireClaim(ref);
    await this.access.checkClaim(viewer, claim, ref);
    return claim;
  }

  /**
   * A page of claims, newest first. A work queue (`queue_for`) keeps reading pages until it has
   * `limit` claims the user can act on or has seen every claim, so older work is not left out.
   */
  async listClaims(query: ClaimListQuery = {}): Promise<ClaimListItem[]> {
    const { queue_for: who, viewer, ...filter } = query;
    const member = await this.access.memberScope(viewer);
    if (member !== undefined) {
      if (filter.memberId !== undefined && filter.memberId !== member) return [];
      filter.memberId = member;
    }
    if (!who) return this.repos.claims.list(filter);
    const { limit = 200, after: _after, ...rest } = filter;
    const queued: ClaimListItem[] = [];
    for await (const claim of eachClaim(this.repos.claims, rest)) {
      const { transitions } = await this.available(claim.id, who.user_id, who.role);
      const ready = transitions.filter((t) => t.allowed && !t.automatic).map((t) => t.id);
      if (ready.length) queued.push({ ...claim, can_run: ready });
      if (queued.length >= limit) break;
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

  /** Everything the claim page of the web UI shows, in one response; `who` is also the viewer. */
  async detail(claimRef: string, who?: ActorRef) {
    const claim = await this.readableClaim(claimRef, who);
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

  async audit(
    claimRef: string,
    viewer?: Viewer,
  ): Promise<{ claim: ClaimSnapshot; entries: AuditEntry[] }> {
    const claim = await this.readableClaim(claimRef, viewer);
    return { claim, entries: await this.repos.audit.list(claim.id) };
  }

  /** The audit trail; `stateChangesOnly` hides in-state actions. */
  async auditEntries(
    claimRef: string,
    options: { stateChangesOnly?: boolean } = {},
    viewer?: Viewer,
  ): Promise<AuditEntry[]> {
    const { entries } = await this.audit(claimRef, viewer);
    return options.stateChangesOnly ? entries.filter((e) => e.from_state !== e.to_state) : entries;
  }

  /** Refused attempts (other users' included), so staff only. */
  async denied(claimRef?: string, viewer?: Viewer): Promise<DeniedAttempt[]> {
    await this.access.checkStaff(viewer, 'Refused attempts');
    if (!claimRef) return this.repos.denied.list();
    const claim = await this.requireClaim(claimRef);
    return this.repos.denied.list(claim.id);
  }

  /**
   * Verifies the audit chain, the replay, the claim row, the outbox and every definition
   * involved. The claim, its entries and its messages are read in one snapshot, so a transition
   * committing meanwhile cannot look like tampering.
   */
  async verify(claimRef: string, viewer?: Viewer): Promise<VerifyReport> {
    const { claim, entries, messages } = await this.options.store.snapshot(async (tx) => {
      const claim = await requireClaim(tx.claims, claimRef);
      await this.access.checkClaim(viewer, claim, claimRef);
      return {
        claim,
        entries: await tx.audit.list(claim.id),
        messages: await tx.outbox.list({ claimId: claim.id }),
      };
    });
    const report = verifyClaimChain(claim, entries, this.options.auditKey);
    report.issues.push(...verifyOutbox(entries, messages));
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

  /** Every claim's report, however many claims there are. */
  async verifyAll(): Promise<VerifyReport[]> {
    const reports: VerifyReport[] = [];
    for await (const c of eachClaim(this.repos.claims)) reports.push(await this.verify(c.id));
    return reports;
  }

  /** One claim's report, or every claim's when no claim is given. */
  async verifyClaims(claimRef?: string): Promise<VerifyReport[]> {
    return claimRef ? [await this.verify(claimRef)] : this.verifyAll();
  }
}
