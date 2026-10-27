import { type EntityManager, In } from 'typeorm';
import type { ClaimFilter, ClaimSnapshot } from '../../domain/types';
import type { ClaimRepository } from '../claim-repository';
import { ClaimEntity } from './entities/claim';
import { iso } from './rows';

export const CLAIM_NO_RE = /^CLM-\d{4}-\d{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The domain snapshot of a row: exactly the hashed fields, timestamps as ISO strings. */
export function rowToClaim(row: Record<string, unknown>): ClaimSnapshot {
  return {
    id: row.id as string,
    claim_no: row.claim_no as string,
    config_hash: row.config_hash as string,
    policy_id: row.policy_id as string,
    member_id: row.member_id as string,
    claim_type: row.claim_type as string,
    claimed_amount: row.claimed_amount as number,
    state: row.state as string,
    state_entered_at: iso(row.state_entered_at),
    version: row.version as number,
    data: row.data as Record<string, unknown>,
    counters: row.counters as Record<string, number>,
    participants: row.participants as Record<string, string[]>,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export class PgClaimRepository implements ClaimRepository {
  constructor(private readonly manager: EntityManager) {}

  private get repo() {
    return this.manager.getRepository(ClaimEntity);
  }

  async find(ref: string, options: { lock?: boolean } = {}): Promise<ClaimSnapshot | null> {
    const byNumber = CLAIM_NO_RE.test(ref);
    if (!byNumber && !UUID_RE.test(ref)) return null;
    const row = await this.repo.findOne({
      where: byNumber ? { claim_no: ref } : { id: ref },
      ...(options.lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    return row ? rowToClaim(row) : null;
  }

  async insert(c: ClaimSnapshot): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .values({ ...c })
      .updateEntity(false)
      .execute();
  }

  async update(c: ClaimSnapshot, expectedVersion: number): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        state: c.state,
        state_entered_at: c.state_entered_at,
        version: c.version,
        data: c.data,
        counters: c.counters,
        participants: c.participants,
        updated_at: c.updated_at,
      })
      .where({ id: c.id, version: expectedVersion })
      .updateEntity(false)
      .execute();
    return result.affected === 1;
  }

  async nextClaimNo(year: number): Promise<string> {
    // Sequences have no ORM API.
    const row = await this.manager
      .createQueryBuilder()
      .select("nextval('claim_no_seq')::int", 'n')
      .fromDummy()
      .getRawOne<{ n: number }>();
    return `CLM-${year}-${String(row?.n).padStart(6, '0')}`;
  }

  async list(filter: ClaimFilter = {}): Promise<ClaimSnapshot[]> {
    const query = this.repo
      .createQueryBuilder('c')
      .where({
        ...(filter.states?.length ? { state: In(filter.states) } : {}),
        ...(filter.assessorId ? { assessor_id: filter.assessorId } : {}),
        ...(filter.memberId ? { member_id: filter.memberId } : {}),
      })
      .orderBy('c.created_at', 'DESC')
      .addOrderBy('c.claim_no', 'DESC')
      .take(filter.limit ?? 200);
    if (filter.after) {
      query.andWhere('(c.created_at, c.claim_no) < (:createdAt, :claimNo)', {
        createdAt: filter.after.created_at,
        claimNo: filter.after.claim_no,
      });
    }
    return (await query.getMany()).map(rowToClaim);
  }
}
