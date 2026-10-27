import type pg from 'pg';
import type { DataSource, EntityManager } from 'typeorm';
import type { OutboxMessage, OutboxStatus } from '../../domain/types';
import type {
  OutboxFilter,
  OutboxInsert,
  OutboxNotifications,
  OutboxRepository,
  OutboxSubscription,
} from '../outbox-repository';
import { OutboxEntity } from './entities/outbox-message';
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
  constructor(private readonly manager: EntityManager) {}

  private get repo() {
    return this.manager.getRepository(OutboxEntity);
  }

  async enqueue(messages: OutboxInsert[]): Promise<number[]> {
    const ids: number[] = [];
    for (const m of messages) {
      const result = await this.repo
        .createQueryBuilder()
        .insert()
        .values({ ...m, next_attempt_at: m.created_at })
        .orIgnore()
        .returning('id')
        .updateEntity(false)
        .execute();
      const row = (result.raw as Array<{ id: number }>)[0];
      if (row) ids.push(row.id);
    }
    return ids;
  }

  async notifyWorkers(): Promise<void> {
    // NOTIFY has no ORM API; it is delivered when the transaction commits.
    await this.manager
      .createQueryBuilder()
      .select('pg_notify(:channel, current_schema())')
      .fromDummy()
      .setParameters({ channel: OUTBOX_CHANNEL })
      .getRawOne();
  }

  async lease(
    workerId: string,
    now: Date,
    leaseMs: number,
    limit: number,
  ): Promise<OutboxMessage[]> {
    const due = this.repo
      .createQueryBuilder('o')
      .select('o.id')
      .where('o.attempts < o.max_attempts')
      .andWhere(
        "((o.status IN ('PENDING', 'FAILED') AND o.next_attempt_at <= :now) OR (o.status = 'PROCESSING' AND o.locked_until < :now))",
      )
      .orderBy('o.id')
      .limit(limit)
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked');
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        status: 'PROCESSING',
        locked_by: workerId,
        locked_until: new Date(now.getTime() + leaseMs).toISOString(),
        // Increment relative to the stored value: SQL expression, no ORM equivalent.
        attempts: () => 'attempts + 1',
      })
      // UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED): TypeORM has no API for a locked
      // subquery in an UPDATE, so the builder above renders it.
      .where(`id IN (${due.getQuery()})`)
      .setParameters({ now: now.toISOString() })
      .returning(COLUMNS)
      .updateEntity(false)
      .execute();
    return (result.raw as Array<Record<string, unknown>>)
      .map(rowToMessage)
      .sort((a, b) => a.id - b.id);
  }

  async reapExpiredLeases(now: Date): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        status: 'DEAD',
        locked_by: null,
        locked_until: null,
        // Keep the last real error if there is one: SQL expression over the stored value.
        last_error: () => "coalesce(last_error, 'lease expired during the final attempt')",
      })
      .where("status = 'PROCESSING' AND locked_until < :now AND attempts >= max_attempts", {
        now: now.toISOString(),
      })
      .updateEntity(false)
      .execute();
    return result.affected ?? 0;
  }

  async markDone(
    id: number,
    workerId: string,
    now: Date,
    result: Record<string, unknown>,
  ): Promise<boolean> {
    const r = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        status: 'DONE',
        processed_at: now.toISOString(),
        result,
        locked_by: null,
        locked_until: null,
        last_error: null,
      })
      .where({ id, locked_by: workerId, status: 'PROCESSING' })
      .updateEntity(false)
      .execute();
    return r.affected === 1;
  }

  async markFailed(
    id: number,
    workerId: string,
    retryAt: Date,
    error: string,
  ): Promise<OutboxStatus | null> {
    const r = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        // Decided from the stored counters in the same statement: SQL expression.
        status: () => "CASE WHEN attempts >= max_attempts THEN 'DEAD' ELSE 'FAILED' END",
        next_attempt_at: retryAt.toISOString(),
        last_error: error.slice(0, 2000),
        locked_by: null,
        locked_until: null,
      })
      .where({ id, locked_by: workerId, status: 'PROCESSING' })
      .returning('status')
      .updateEntity(false)
      .execute();
    return (r.raw as Array<{ status: OutboxStatus }>)[0]?.status ?? null;
  }

  async nextDueAt(): Promise<Date | null> {
    const row = await this.repo
      .createQueryBuilder('o')
      .select('min(o.next_attempt_at)', 'next')
      .where("o.status IN ('PENDING', 'FAILED') AND o.attempts < o.max_attempts")
      .getRawOne<{ next: Date | null }>();
    return row?.next ?? null;
  }

  async list(filter: OutboxFilter = {}): Promise<OutboxMessage[]> {
    const rows = await this.repo.find({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.claimId ? { claim_id: filter.claimId } : {}),
        ...(filter.effectType ? { effect_type: filter.effectType } : {}),
      },
      order: { id: 'ASC' },
    });
    return rows.map(rowToMessage);
  }

  async retryAllDead(now: Date, filter: Omit<OutboxFilter, 'status'> = {}): Promise<number> {
    const r = await this.repo
      .createQueryBuilder()
      .update()
      .set({ status: 'PENDING', attempts: 0, next_attempt_at: now.toISOString(), last_error: null })
      .where({
        status: 'DEAD',
        ...(filter.claimId ? { claim_id: filter.claimId } : {}),
        ...(filter.effectType ? { effect_type: filter.effectType } : {}),
      })
      .updateEntity(false)
      .execute();
    return r.affected ?? 0;
  }

  async retryDead(id: number, now: Date): Promise<boolean> {
    const r = await this.repo
      .createQueryBuilder()
      .update()
      .set({ status: 'PENDING', attempts: 0, next_attempt_at: now.toISOString(), last_error: null })
      .where({ id, status: 'DEAD' })
      .updateEntity(false)
      .execute();
    return r.affected === 1;
  }
}

/**
 * LISTEN on a connection of its own from the data source's pool; only notifications for
 * `schema` wake the listener. TypeORM has no LISTEN API, so this uses the pg client directly.
 */
export class PgOutboxNotifications implements OutboxNotifications {
  constructor(
    private readonly dataSource: DataSource,
    private readonly schema: string,
  ) {}

  async listen(handlers: {
    onNotify: () => void;
    onError: (error: Error) => void;
  }): Promise<OutboxSubscription> {
    const pool = (this.dataSource.driver as unknown as { master: pg.Pool }).master;
    const listener = await pool.connect();
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
