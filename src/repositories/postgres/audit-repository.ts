import type { EntityManager } from 'typeorm';
import type { AuditEntry, DeniedAttempt } from '../../domain/types';
import type {
  AuditRepository,
  ChainHead,
  DeniedAttemptRepository,
  DeniedRecord,
} from '../audit-repository';
import { AuditEntity } from './entities/audit-entry';
import { DeniedEntity } from './entities/denied-attempt';
import { iso } from './rows';

export function rowToEntry(row: Record<string, unknown>): AuditEntry {
  return {
    entry_id: row.entry_id as string,
    claim_id: row.claim_id as string,
    claim_seq: row.claim_seq as number,
    transition_id: row.transition_id as string,
    from_state: (row.from_state as string | null) ?? null,
    to_state: row.to_state as string,
    actor_user_id: row.actor_user_id as string,
    actor_role: row.actor_role as string,
    reason: (row.reason as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    input: row.input as Record<string, unknown>,
    changes: row.changes as AuditEntry['changes'],
    decision_context: row.decision_context as Record<string, unknown>,
    effects: row.effects as AuditEntry['effects'],
    config_hash: row.config_hash as string,
    claim_version: row.claim_version as number,
    snapshot_hash: row.snapshot_hash as string,
    prev_hash: row.prev_hash as string,
    hash: row.hash as string,
    occurred_at: iso(row.occurred_at),
  };
}

export class PgAuditRepository implements AuditRepository {
  constructor(private readonly manager: EntityManager) {}

  private get repo() {
    return this.manager.getRepository(AuditEntity);
  }

  async insert(e: AuditEntry): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .values({ ...e })
      .updateEntity(false)
      .execute();
  }

  async list(claimId: string): Promise<AuditEntry[]> {
    const rows = await this.repo.find({
      where: { claim_id: claimId },
      order: { claim_seq: 'ASC' },
    });
    return rows.map(rowToEntry);
  }

  async find(entryId: string): Promise<AuditEntry | null> {
    const row = await this.repo.findOneBy({ entry_id: entryId });
    return row ? rowToEntry(row) : null;
  }

  async head(claimId: string): Promise<ChainHead | null> {
    const row = await this.repo.findOne({
      select: { claim_seq: true, hash: true },
      where: { claim_id: claimId },
      order: { claim_seq: 'DESC' },
    });
    return row ? { claim_seq: row.claim_seq, hash: row.hash } : null;
  }
}

export class PgDeniedAttemptRepository implements DeniedAttemptRepository {
  constructor(private readonly manager: EntityManager) {}

  private get repo() {
    return this.manager.getRepository(DeniedEntity);
  }

  async record(d: DeniedRecord): Promise<boolean> {
    const bucket = new Date(d.occurred_at);
    bucket.setUTCSeconds(0, 0);
    // The only unique constraint besides the key is denied_attempts_dedupe.
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .values({ ...d, bucket_start: bucket.toISOString() })
      .orIgnore()
      .returning('id')
      .updateEntity(false)
      .execute();
    return (result.raw as unknown[]).length === 1;
  }

  async list(claimId?: string): Promise<DeniedAttempt[]> {
    const rows = await this.repo.find({
      where: claimId ? { claim_id: claimId } : {},
      order: { id: 'ASC' },
    });
    return rows.map((r) => ({
      id: r.id,
      claim_id: r.claim_id,
      actor_user_id: r.actor_user_id,
      actor_role: r.actor_role,
      transition_id: r.transition_id,
      error_code: r.error_code,
      message: r.message,
      details: r.details as Record<string, unknown>,
      occurred_at: iso(r.occurred_at),
    }));
  }
}
