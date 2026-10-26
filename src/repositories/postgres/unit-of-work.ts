import type pg from 'pg';
import { type Db, inTransaction } from '../../infra/db/pool';
import type { Repositories, UnitOfWork } from '../unit-of-work';
import { PgAuditRepository, PgDeniedAttemptRepository } from './audit-repository';
import { PgClaimRepository } from './claim-repository';
import { PgDefinitionRepository } from './definition-repository';
import { PgIdempotencyRepository } from './idempotency-repository';
import { PgMockGatewayRepository } from './mock-gateway-repository';
import { PgOutboxRepository } from './outbox-repository';
import { PgPolicyRepository, PgUserRepository } from './reference-repository';

/** Every repository on one connection (a pool, or the client of a transaction). */
export function createPgRepositories(db: Db): Repositories {
  return {
    claims: new PgClaimRepository(db),
    audit: new PgAuditRepository(db),
    denied: new PgDeniedAttemptRepository(db),
    outbox: new PgOutboxRepository(db),
    users: new PgUserRepository(db),
    policies: new PgPolicyRepository(db),
    definitions: new PgDefinitionRepository(db),
    idempotency: new PgIdempotencyRepository(db),
    mockGateway: new PgMockGatewayRepository(db),
  };
}

export class PgUnitOfWork implements UnitOfWork {
  readonly repos: Repositories;

  constructor(private readonly pool: pg.Pool) {
    this.repos = createPgRepositories(pool);
  }

  transaction<T>(fn: (tx: Repositories) => Promise<T>): Promise<T> {
    return inTransaction(this.pool, (client) => fn(createPgRepositories(client)));
  }
}
