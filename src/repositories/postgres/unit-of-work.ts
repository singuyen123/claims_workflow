import type { DataSource, EntityManager } from 'typeorm';
import type { Repositories, UnitOfWork } from '../unit-of-work';
import { PgAuditRepository, PgDeniedAttemptRepository } from './audit-repository';
import { PgClaimRepository } from './claim-repository';
import { PgDefinitionRepository } from './definition-repository';
import { PgIdempotencyRepository } from './idempotency-repository';
import { PgMockGatewayRepository } from './mock-gateway-repository';
import { PgOutboxRepository } from './outbox-repository';
import { PgPolicyRepository, PgUserRepository } from './reference-repository';

/** Every repository on one entity manager (the data source's, or a transaction's). */
export function createPgRepositories(manager: EntityManager): Repositories {
  return {
    claims: new PgClaimRepository(manager),
    audit: new PgAuditRepository(manager),
    denied: new PgDeniedAttemptRepository(manager),
    outbox: new PgOutboxRepository(manager),
    users: new PgUserRepository(manager),
    policies: new PgPolicyRepository(manager),
    definitions: new PgDefinitionRepository(manager),
    idempotency: new PgIdempotencyRepository(manager),
    mockGateway: new PgMockGatewayRepository(manager),
  };
}

export class PgUnitOfWork implements UnitOfWork {
  readonly repos: Repositories;

  constructor(private readonly dataSource: DataSource) {
    this.repos = createPgRepositories(dataSource.manager);
  }

  transaction<T>(fn: (tx: Repositories) => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) => fn(createPgRepositories(manager)));
  }

  snapshot<T>(fn: (tx: Repositories) => Promise<T>): Promise<T> {
    return this.dataSource.transaction('REPEATABLE READ', (manager) =>
      fn(createPgRepositories(manager)),
    );
  }
}
