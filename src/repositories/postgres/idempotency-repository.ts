import type { Db } from '../../infra/db/pool';
import type { IdempotencyRecord, IdempotencyRepository } from '../idempotency-repository';
import { iso } from './rows';

export class PgIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly db: Db) {}

  async lock(key: string): Promise<void> {
    await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
  }

  async find(key: string): Promise<IdempotencyRecord | null> {
    const { rows } = await this.db.query(
      'SELECT key, actor_user_id, request_hash, claim_id, response, created_at FROM idempotency_keys WHERE key = $1',
      [key],
    );
    return rows[0] ? { ...rows[0], created_at: iso(rows[0].created_at) } : null;
  }

  async save(r: IdempotencyRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO idempotency_keys (key, actor_user_id, request_hash, claim_id, response, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        r.key,
        r.actor_user_id,
        r.request_hash,
        r.claim_id,
        JSON.stringify(r.response),
        r.created_at,
      ],
    );
  }
}
