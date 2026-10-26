import type pg from 'pg';
import type { OutboxMessage, OutboxStatus } from '../../domain/types';
import type { Db } from '../../infra/db/pool';
import type {
  OutboxFilter,
  OutboxInsert,
  OutboxNotifications,
  OutboxRepository,
  OutboxSubscription,
} from '../outbox-repository';
import { iso, isoOrNull } from './rows';

/** NOTIFY channel; the payload is the schema name so workers ignore other schemas' traffic. */
export const OUTBOX_CHANNEL = 'claims_outbox';

const COLUMNS =
  'id, claim_id, audit_entry_id, effect_type, payload, idempotency_key, status, attempts, ' +
  'max_attempts, next_attempt_at, locked_by, locked_until, last_error, result, created_at, processed_at';

export function rowToMessage(row: Record<string, unknown>): OutboxMessage {
  return {
    id: row.id as number,
    claim_id: row.claim_id as string,
    audit_entry_id: row.audit_entry_id as string,
    effect_type: row.effect_type as OutboxMessage['effect_type'],
    payload: row.payload as Record<string, unknown>,
    idempotency_key: row.idempotency_key as string,
    status: row.status as OutboxStatus,
    attempts: row.attempts as number,
    max_attempts: row.max_attempts as number,
    next_attempt_at: iso(row.next_attempt_at),
    locked_by: (row.locked_by as string | null) ?? null,
    locked_until: isoOrNull(row.locked_until),
    last_error: (row.last_error as string | null) ?? null,
    result: (row.result as Record<string, unknown> | null) ?? null,
    created_at: iso(row.created_at),
    processed_at: isoOrNull(row.processed_at),
  };
}

export class PgOutboxRepository implements OutboxRepository {
  constructor(private readonly db: Db) {}

  async enqueue(messages: OutboxInsert[]): Promise<number[]> {
    const ids: number[] = [];
    for (const m of messages) {
      const { rows } = await this.db.query<{ id: number }>(
        `INSERT INTO outbox (claim_id, audit_entry_id, effect_type, payload, idempotency_key, next_attempt_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          m.claim_id,
          m.audit_entry_id,
          m.effect_type,
          JSON.stringify(m.payload),
          m.idempotency_key,
          m.created_at,
        ],
      );
      if (rows[0]) ids.push(rows[0].id);
    }
    return ids;
  }

  async notifyWorkers(): Promise<void> {
    await this.db.query('SELECT pg_notify($1, current_schema())', [OUTBOX_CHANNEL]);
  }

  async lease(
    workerId: string,
    now: Date,
    leaseMs: number,
    limit: number,
  ): Promise<OutboxMessage[]> {
    const { rows } = await this.db.query(
      `UPDATE outbox
          SET status = 'PROCESSING', locked_by = $1, locked_until = $2, attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM outbox
           WHERE attempts < max_attempts
             AND ((status IN ('PENDING', 'FAILED') AND next_attempt_at <= $3)
                  OR (status = 'PROCESSING' AND locked_until < $3))
           ORDER BY id
           LIMIT $4
           FOR UPDATE SKIP LOCKED)
        RETURNING ${COLUMNS}`,
      [workerId, new Date(now.getTime() + leaseMs).toISOString(), now.toISOString(), limit],
    );
    return rows.map(rowToMessage).sort((a, b) => a.id - b.id);
  }

  async reapExpiredLeases(now: Date): Promise<number> {
    const r = await this.db.query(
      `UPDATE outbox
          SET status = 'DEAD', locked_by = NULL, locked_until = NULL,
              last_error = coalesce(last_error, 'lease expired during the final attempt')
        WHERE status = 'PROCESSING' AND locked_until < $1 AND attempts >= max_attempts`,
      [now.toISOString()],
    );
    return r.rowCount ?? 0;
  }

  async markDone(
    id: number,
    workerId: string,
    now: Date,
    result: Record<string, unknown>,
  ): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE outbox
          SET status = 'DONE', processed_at = $3, result = $4, locked_by = NULL, locked_until = NULL, last_error = NULL
        WHERE id = $1 AND locked_by = $2 AND status = 'PROCESSING'`,
      [id, workerId, now.toISOString(), JSON.stringify(result)],
    );
    return r.rowCount === 1;
  }

  async markFailed(
    id: number,
    workerId: string,
    retryAt: Date,
    error: string,
  ): Promise<OutboxStatus | null> {
    const { rows } = await this.db.query<{ status: OutboxStatus }>(
      `UPDATE outbox
          SET status = CASE WHEN attempts >= max_attempts THEN 'DEAD' ELSE 'FAILED' END,
              next_attempt_at = $3, last_error = $4, locked_by = NULL, locked_until = NULL
        WHERE id = $1 AND locked_by = $2 AND status = 'PROCESSING'
        RETURNING status`,
      [id, workerId, retryAt.toISOString(), error.slice(0, 2000)],
    );
    return rows[0]?.status ?? null;
  }

  async nextDueAt(): Promise<Date | null> {
    const { rows } = await this.db.query<{ next: Date | null }>(
      `SELECT min(next_attempt_at) AS next FROM outbox
        WHERE status IN ('PENDING', 'FAILED') AND attempts < max_attempts`,
    );
    return rows[0]?.next ?? null;
  }

  async list(filter: OutboxFilter = {}): Promise<OutboxMessage[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.claimId) {
      params.push(filter.claimId);
      where.push(`claim_id = $${params.length}`);
    }
    const { rows } = await this.db.query(
      `SELECT ${COLUMNS} FROM outbox ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`,
      params,
    );
    return rows.map(rowToMessage);
  }

  async retryDead(id: number, now: Date): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE outbox
          SET status = 'PENDING', attempts = 0, next_attempt_at = $2, last_error = NULL
        WHERE id = $1 AND status = 'DEAD'`,
      [id, now.toISOString()],
    );
    return r.rowCount === 1;
  }
}

/** LISTEN on a connection of its own; only notifications for `schema` wake the listener. */
export class PgOutboxNotifications implements OutboxNotifications {
  constructor(
    private readonly pool: pg.Pool,
    private readonly schema: string,
  ) {}

  async listen(handlers: {
    onNotify: () => void;
    onError: (error: Error) => void;
  }): Promise<OutboxSubscription> {
    const listener = await this.pool.connect();
    const onNotification = (n: pg.Notification) => {
      if (n.channel === OUTBOX_CHANNEL && n.payload === this.schema) handlers.onNotify();
    };
    listener.on('notification', onNotification);
    listener.on('error', handlers.onError);
    const close = async () => {
      listener.off('notification', onNotification);
      const unlistened = await listener.query(`UNLISTEN ${OUTBOX_CHANNEL}`).then(
        () => true,
        () => false,
      );
      listener.off('error', handlers.onError);
      // A connection that could not UNLISTEN is broken: destroy it instead of returning it.
      listener.release(!unlistened);
    };
    try {
      await listener.query(`LISTEN ${OUTBOX_CHANNEL}`);
    } catch (error) {
      await close();
      throw error;
    }
    return { channel: OUTBOX_CHANNEL, schema: this.schema, close };
  }
}
