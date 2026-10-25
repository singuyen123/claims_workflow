import { hostname } from 'node:os';
import type pg from 'pg';
import { type Clock, ManualClock, systemClock } from '../../app/clock';
import { leaseBatch, markDone, markFailed, reapExpiredLeases } from '../repos/outbox';
import { OUTBOX_CHANNEL } from './channel';
import { HANDLERS, type Handler } from './handlers';

export interface WorkerOptions {
  pool: pg.Pool;
  schema: string;
  clock?: Clock;
  workerId?: string;
  leaseMs?: number;
  batchSize?: number;
  pollMs?: number;
  log?: (line: string) => void;
  handlers?: Partial<Record<keyof typeof HANDLERS, Handler>>;
}

export interface RoundResult {
  leased: number;
  done: number;
  failed: number;
  dead: number;
}

/** 1 s, 2 s, 4 s … capped at one minute. */
export function backoffMs(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

/**
 * Delivers outbox messages at least once. Handlers are idempotent (keyed by the message's
 * idempotency key), which turns at-least-once delivery into effectively-once side effects.
 */
export class OutboxWorker {
  private readonly clock: Clock;
  readonly workerId: string;
  private readonly log: (line: string) => void;
  private readonly handlers: Record<string, Handler>;

  constructor(private readonly options: WorkerOptions) {
    this.clock = options.clock ?? systemClock;
    this.workerId = options.workerId ?? `${hostname()}:${process.pid}`;
    this.log = options.log ?? ((line) => console.log(line));
    this.handlers = { ...HANDLERS, ...(options.handlers ?? {}) };
  }

  async processOnce(): Promise<RoundResult> {
    const { pool } = this.options;
    const now = this.clock.now();
    const reaped = await reapExpiredLeases(pool, now);
    const batch = await leaseBatch(
      pool,
      this.workerId,
      now,
      this.options.leaseMs ?? 30_000,
      this.options.batchSize ?? 20,
    );
    const result: RoundResult = { leased: batch.length, done: 0, failed: 0, dead: reaped };
    for (const message of batch) {
      const handler = this.handlers[message.effect_type];
      try {
        if (!handler) throw new Error(`no handler for effect type ${message.effect_type}`);
        const output = await handler(message, { db: pool, now: this.clock.now(), log: this.log });
        await markDone(pool, message.id, this.workerId, this.clock.now(), output);
        result.done++;
      } catch (error) {
        const reason = (error as Error).message;
        const retryAt = new Date(this.clock.now().getTime() + backoffMs(message.attempts));
        const status = await markFailed(pool, message.id, this.workerId, retryAt, reason);
        if (status === 'DEAD') {
          result.dead++;
          this.log(
            `[dead] outbox #${message.id} ${message.effect_type} gave up after ${message.attempts} attempts: ${reason}`,
          );
        } else {
          result.failed++;
          this.log(
            `[retry] outbox #${message.id} ${message.effect_type} attempt ${message.attempts}/${message.max_attempts} failed: ${reason}; next try at ${retryAt.toISOString()}`,
          );
        }
      }
    }
    return result;
  }

  /**
   * Processes until nothing is due. With a ManualClock it also fast-forwards to the next retry
   * instead of sleeping, which keeps the scenario runner and tests fast and deterministic.
   */
  async drain(maxRounds = 100): Promise<RoundResult> {
    const total: RoundResult = { leased: 0, done: 0, failed: 0, dead: 0 };
    for (let round = 0; round < maxRounds; round++) {
      const r = await this.processOnce();
      total.leased += r.leased;
      total.done += r.done;
      total.failed += r.failed;
      total.dead += r.dead;
      if (r.leased > 0) continue;
      if (!(this.clock instanceof ManualClock)) break;
      const next = await this.nextDueAt();
      if (!next) break;
      // A due message may just be leased by another worker; never move the clock backwards.
      if (next.getTime() > this.clock.now().getTime()) this.clock.set(next);
    }
    return total;
  }

  private async nextDueAt(): Promise<Date | null> {
    const { rows } = await this.options.pool.query<{ next: Date | null }>(
      `SELECT min(next_attempt_at) AS next FROM outbox
        WHERE status IN ('PENDING', 'FAILED') AND attempts < max_attempts`,
    );
    return rows[0]?.next ?? null;
  }

  /** Long-running loop: wakes on NOTIFY from committed transactions and polls as a fallback. */
  async run(signal: AbortSignal): Promise<void> {
    const listener = await this.options.pool.connect();
    let wake: (() => void) | undefined;
    // Set when a notification arrives while a batch is being processed, so it is not missed.
    let pending = false;
    const onNotify = (n: pg.Notification) => {
      if (n.channel !== OUTBOX_CHANNEL || n.payload !== this.options.schema) return;
      pending = true;
      wake?.();
    };
    const onAbort = () => wake?.();
    // If the LISTEN connection drops, notifications stop but polling keeps the worker going.
    const onError = (error: Error) =>
      this.log(
        `[worker] notification connection lost (${error.message}); polling every ${this.options.pollMs ?? 2000} ms`,
      );
    listener.on('notification', onNotify);
    listener.on('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await listener.query(`LISTEN ${OUTBOX_CHANNEL}`);
      this.log(
        `[worker] ${this.workerId} listening on ${OUTBOX_CHANNEL} (schema ${this.options.schema})`,
      );
      while (!signal.aborted) {
        pending = false;
        let leased = 0;
        try {
          leased = (await this.processOnce()).leased;
        } catch (error) {
          // A database outage must not kill the worker: wait one poll interval and try again.
          this.log(`[worker] round failed: ${(error as Error).message}`);
          pending = false;
        }
        if (leased > 0 || pending) continue;
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          const timer = setTimeout(resolve, this.options.pollMs ?? 2000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = undefined;
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      listener.off('notification', onNotify);
      const unlistened = await listener.query(`UNLISTEN ${OUTBOX_CHANNEL}`).then(
        () => true,
        () => false,
      );
      listener.off('error', onError);
      // A connection that could not UNLISTEN is broken: destroy it instead of returning it.
      listener.release(!unlistened);
    }
  }
}
