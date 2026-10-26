import type { OutboxMessage, OutboxStatus } from '../domain/types';

export interface OutboxInsert {
  claim_id: string;
  audit_entry_id: string;
  effect_type: OutboxMessage['effect_type'];
  payload: Record<string, unknown>;
  idempotency_key: string;
  created_at: string;
}

export interface OutboxFilter {
  status?: OutboxStatus;
  claimId?: string;
}

/** The transactional outbox of external side effects. */
export interface OutboxRepository {
  /** Inserts messages; a message whose idempotency key already exists is skipped. */
  enqueue(messages: OutboxInsert[]): Promise<number[]>;
  /** Wakes listening workers when the current transaction commits. */
  notifyWorkers(): Promise<void>;
  /**
   * Atomically leases up to `limit` due messages to `workerId`. Several workers can lease side
   * by side without taking the same message; an expired lease makes a message eligible again.
   */
  lease(workerId: string, now: Date, leaseMs: number, limit: number): Promise<OutboxMessage[]>;
  /** Messages whose worker died during their final attempt become DEAD instead of hanging. */
  reapExpiredLeases(now: Date): Promise<number>;
  markDone(
    id: number,
    workerId: string,
    now: Date,
    result: Record<string, unknown>,
  ): Promise<boolean>;
  /** Records a failure; the message is retried at `retryAt` or becomes DEAD after max_attempts. */
  markFailed(
    id: number,
    workerId: string,
    retryAt: Date,
    error: string,
  ): Promise<OutboxStatus | null>;
  /** When the next waiting message is due, or null when none is waiting. */
  nextDueAt(): Promise<Date | null>;
  list(filter?: OutboxFilter): Promise<OutboxMessage[]>;
  /** Gives a DEAD message a fresh set of attempts; false if it is not DEAD. */
  retryDead(id: number, now: Date): Promise<boolean>;
}

export interface OutboxSubscription {
  channel: string;
  schema: string;
  close(): Promise<void>;
}

/**
 * Wake-ups for outbox workers. Listening holds a connection of its own, so this is not part of
 * the repositories a transaction hands out.
 */
export interface OutboxNotifications {
  listen(handlers: {
    onNotify: () => void;
    /** The listening connection was lost; notifications stop until the next `listen`. */
    onError: (error: Error) => void;
  }): Promise<OutboxSubscription>;
}
