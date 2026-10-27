import type { EntityManager } from 'typeorm';
import type { IdempotencyRecord, IdempotencyRepository } from '../idempotency-repository';
import { IdempotencyEntity } from './entities/idempotency-key';
import { iso } from './rows';

export class PgIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly manager: EntityManager) {}

  private get repo() {
    return this.manager.getRepository(IdempotencyEntity);
  }

  async lock(key: string): Promise<void> {
    // Advisory locks have no ORM API.
    await this.manager
      .createQueryBuilder()
      .select('pg_advisory_xact_lock(hashtextextended(:key, 0))')
      .fromDummy()
      .setParameters({ key })
      .getRawOne();
  }

  async find(key: string): Promise<IdempotencyRecord | null> {
    const row = await this.repo.findOneBy({ key });
    return row
      ? {
          key: row.key,
          actor_user_id: row.actor_user_id,
          request_hash: row.request_hash,
          claim_id: row.claim_id,
          response: row.response as Record<string, unknown>,
          created_at: iso(row.created_at),
        }
      : null;
  }

  async save(r: IdempotencyRecord): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .values({ ...r })
      .updateEntity(false)
      .execute();
  }
}
