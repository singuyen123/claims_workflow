import type {
  MockNotification,
  MockPayment,
  OutboxMessage,
  OutboxStatus,
  Policy,
  User,
} from '../domain/types';
import type { Repositories } from '../repositories/unit-of-work';
import { ReadAccess, type Viewer } from './access';
import { requireClaim } from './claim-query-service';
import { type Clock, systemClock } from './clock';
import type { InputField } from './workflow-service';

/** One allowed value of a form input; user references carry the user, for labels. */
export interface InputChoice {
  value: string;
  user?: User;
}

/** Reference data and operator controls that sit next to the workflow: outbox, mocks. */
export class OperationsService {
  private readonly access: ReadAccess;

  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock = systemClock,
  ) {
    this.access = new ReadAccess(repos.users);
  }

  /** Every user, service accounts included. */
  users(): Promise<User[]> {
    return this.repos.users.list();
  }

  /** Users a person can act as (no service accounts). */
  async people(): Promise<User[]> {
    return (await this.repos.users.list()).filter((u) => !u.service_account);
  }

  /** Every policy, or only the viewer's own when the viewer is a policyholder. */
  async policies(viewer?: Viewer): Promise<Policy[]> {
    return this.access.filterPolicies(viewer, await this.repos.policies.list());
  }

  policy(id: string): Promise<Policy | null> {
    return this.repos.policies.find(id);
  }

  /**
   * The values each choice input accepts: enum values, existing policies, and the people who
   * hold the role a user reference asks for.
   */
  async inputChoices(fields: InputField[]): Promise<Record<string, InputChoice[]>> {
    const users = await this.repos.users.list();
    const policies = await this.repos.policies.list();
    const choices: Record<string, InputChoice[]> = {};
    for (const field of fields) {
      if (field.type === 'enum')
        choices[field.name] = (field.values ?? []).map((v) => ({ value: v }));
      if (field.type === 'policy_ref') choices[field.name] = policies.map((p) => ({ value: p.id }));
      if (field.type === 'user_ref') {
        choices[field.name] = users
          .filter((u) => !u.service_account && (!field.role || u.roles.includes(field.role)))
          .map((u) => ({ value: u.id, user: u }));
      }
    }
    return choices;
  }

  // ── outbox ─────────────────────────────────────────────────────────────────────────────────

  /** Outbox messages, optionally of one claim (number or id) and one status; staff only. */
  async outbox(
    filter: { status?: OutboxStatus; claim?: string } = {},
    viewer?: Viewer,
  ): Promise<OutboxMessage[]> {
    await this.access.checkStaff(viewer, 'The outbox');
    const claimId = filter.claim
      ? (await requireClaim(this.repos.claims, filter.claim)).id
      : undefined;
    return this.repos.outbox.list({
      ...(filter.status ? { status: filter.status } : {}),
      ...(claimId ? { claimId } : {}),
    });
  }

  /** Gives a DEAD message a fresh set of attempts; false if it is not DEAD. */
  retryOutbox(id: number): Promise<boolean> {
    return this.repos.outbox.retryDead(id, this.clock.now());
  }

  /**
   * Gives every DEAD message (of one claim and one effect type, when given) a fresh set of
   * attempts, e.g. once a gateway outage is over. Returns how many were queued again.
   */
  async retryDeadOutbox(
    filter: { claim?: string; effect_type?: OutboxMessage['effect_type'] } = {},
  ): Promise<number> {
    const claimId = filter.claim
      ? (await requireClaim(this.repos.claims, filter.claim)).id
      : undefined;
    return this.repos.outbox.retryAllDead(this.clock.now(), {
      ...(claimId ? { claimId } : {}),
      ...(filter.effect_type ? { effectType: filter.effect_type } : {}),
    });
  }

  // ── mock payment gateway and notification channel ──────────────────────────────────────────

  /** Makes the next `count` calls to the mock payment gateway fail. */
  failNextPayments(count: number): Promise<void> {
    return this.repos.mockGateway.setFaults(count);
  }

  async payments(claim?: string): Promise<MockPayment[]> {
    const claimId = claim ? (await requireClaim(this.repos.claims, claim)).id : undefined;
    return this.repos.mockGateway.listPayments(claimId);
  }

  /** Sent notifications; a viewer sees those of one claim they may read, staff see them all. */
  async notifications(claim?: string, viewer?: Viewer): Promise<MockNotification[]> {
    if (!claim) await this.access.checkStaff(viewer, 'Notifications of every claim');
    const found = claim ? await requireClaim(this.repos.claims, claim) : undefined;
    if (found && claim) await this.access.checkClaim(viewer, found, claim);
    return this.repos.mockGateway.listNotifications(found?.id);
  }
}
