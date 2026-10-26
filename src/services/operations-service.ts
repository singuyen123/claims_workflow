import type {
  MockNotification,
  MockPayment,
  OutboxMessage,
  OutboxStatus,
  Policy,
  User,
} from '../domain/types';
import type { Repositories } from '../repositories/unit-of-work';
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
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock = systemClock,
  ) {}

  /** Every user, service accounts included. */
  users(): Promise<User[]> {
    return this.repos.users.list();
  }

  /** Users a person can act as (no service accounts). */
  async people(): Promise<User[]> {
    return (await this.repos.users.list()).filter((u) => !u.service_account);
  }

  policies(): Promise<Policy[]> {
    return this.repos.policies.list();
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

  /** Outbox messages, optionally of one claim (number or id) and one status. */
  async outbox(filter: { status?: OutboxStatus; claim?: string } = {}): Promise<OutboxMessage[]> {
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

  // ── mock payment gateway and notification channel ──────────────────────────────────────────

  /** Makes the next `count` calls to the mock payment gateway fail. */
  failNextPayments(count: number): Promise<void> {
    return this.repos.mockGateway.setFaults(count);
  }

  async payments(claim?: string): Promise<MockPayment[]> {
    const claimId = claim ? (await requireClaim(this.repos.claims, claim)).id : undefined;
    return this.repos.mockGateway.listPayments(claimId);
  }

  async notifications(claim?: string): Promise<MockNotification[]> {
    const claimId = claim ? (await requireClaim(this.repos.claims, claim)).id : undefined;
    return this.repos.mockGateway.listNotifications(claimId);
  }
}
