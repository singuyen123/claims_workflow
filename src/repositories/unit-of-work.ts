import type { AuditRepository, DeniedAttemptRepository } from './audit-repository';
import type { ClaimRepository } from './claim-repository';
import type { DefinitionRepository } from './definition-repository';
import type { IdempotencyRepository } from './idempotency-repository';
import type { MockGatewayRepository } from './mock-gateway-repository';
import type { OutboxRepository } from './outbox-repository';
import type { PolicyRepository, UserRepository } from './reference-repository';

/** Repositories bound to one connection: the pool, or the connection of a transaction. */
export interface Repositories {
  claims: ClaimRepository;
  audit: AuditRepository;
  denied: DeniedAttemptRepository;
  outbox: OutboxRepository;
  users: UserRepository;
  policies: PolicyRepository;
  definitions: DefinitionRepository;
  idempotency: IdempotencyRepository;
  mockGateway: MockGatewayRepository;
}

/** How services reach the data: every query goes through these repositories. */
export interface UnitOfWork {
  /** Repositories on the pool: each call commits on its own. */
  readonly repos: Repositories;
  /**
   * Runs `fn` in one transaction: commits when it resolves, rolls back when it throws. The
   * repositories it receives share the transaction's connection, which is released afterwards.
   */
  transaction<T>(fn: (tx: Repositories) => Promise<T>): Promise<T>;
  /**
   * Runs `fn` in one REPEATABLE READ transaction, so several reads see the same committed state
   * (a claim and its audit trail, for instance). For reads only.
   */
  snapshot<T>(fn: (tx: Repositories) => Promise<T>): Promise<T>;
}
