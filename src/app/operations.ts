import type pg from 'pg';
import type { OutboxMessage, OutboxStatus, Policy } from '../domain/types';
import {
  listNotifications,
  listPayments,
  type MockNotification,
  type MockPayment,
  setFaults,
} from '../infra/repos/mock';
import { listOutbox, retryDead } from '../infra/repos/outbox';
import {
  findPolicy,
  listDefinitions,
  listPolicies,
  type StoredDefinition,
} from '../infra/repos/reference';
import { type Clock, systemClock } from './clock';

export { describeRecipient } from '../infra/outbox/handlers';
export type { MockNotification, MockPayment };
export type DefinitionSummary = Omit<StoredDefinition, 'content'>;

/** Operator queries and controls that sit next to the workflow: outbox, mocks, definitions. */
export class Operations {
  constructor(
    private readonly pool: pg.Pool,
    private readonly clock: Clock = systemClock,
  ) {}

  outbox(filter: { status?: OutboxStatus; claimId?: string } = {}): Promise<OutboxMessage[]> {
    return listOutbox(this.pool, filter);
  }

  /** Gives a DEAD message a fresh set of attempts; false if it is not DEAD. */
  retryOutbox(id: number): Promise<boolean> {
    return retryDead(this.pool, id, this.clock.now());
  }

  /** Makes the next `count` calls to the mock payment gateway fail. */
  failNextPayments(count: number): Promise<void> {
    return setFaults(this.pool, count);
  }

  payments(claimId?: string): Promise<MockPayment[]> {
    return listPayments(this.pool, claimId);
  }

  notifications(claimId?: string): Promise<MockNotification[]> {
    return listNotifications(this.pool, claimId);
  }

  definitions(): Promise<DefinitionSummary[]> {
    return listDefinitions(this.pool);
  }

  policies(): Promise<Policy[]> {
    return listPolicies(this.pool);
  }

  policy(id: string): Promise<Policy | null> {
    return findPolicy(this.pool, id);
  }
}
