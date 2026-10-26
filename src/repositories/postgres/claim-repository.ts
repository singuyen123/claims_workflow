import type { ClaimFilter, ClaimSnapshot } from '../../domain/types';
import type { Db } from '../../infra/db/pool';
import type { ClaimRepository } from '../claim-repository';
import { iso } from './rows';

export const CLAIM_NO_RE = /^CLM-\d{4}-\d{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS =
  'id, claim_no, config_hash, policy_id, member_id, claim_type, claimed_amount, state, ' +
  'state_entered_at, version, data, counters, participants, created_at, updated_at';

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
  constructor(private readonly db: Db) {}

  async find(ref: string, options: { lock?: boolean } = {}): Promise<ClaimSnapshot | null> {
    const byNumber = CLAIM_NO_RE.test(ref);
    if (!byNumber && !UUID_RE.test(ref)) return null;
    const { rows } = await this.db.query(
      `SELECT ${COLUMNS} FROM claims WHERE ${byNumber ? 'claim_no' : 'id'} = $1${options.lock ? ' FOR UPDATE' : ''}`,
      [ref],
    );
    return rows[0] ? rowToClaim(rows[0]) : null;
  }

  async insert(c: ClaimSnapshot): Promise<void> {
    await this.db.query(
      `INSERT INTO claims (${COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        c.id,
        c.claim_no,
        c.config_hash,
        c.policy_id,
        c.member_id,
        c.claim_type,
        c.claimed_amount,
        c.state,
        c.state_entered_at,
        c.version,
        JSON.stringify(c.data),
        JSON.stringify(c.counters),
        JSON.stringify(c.participants),
        c.created_at,
        c.updated_at,
      ],
    );
  }

  async update(c: ClaimSnapshot, expectedVersion: number): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE claims
          SET state = $2, state_entered_at = $3, version = $4, data = $5, counters = $6,
              participants = $7, updated_at = $8
        WHERE id = $1 AND version = $9`,
      [
        c.id,
        c.state,
        c.state_entered_at,
        c.version,
        JSON.stringify(c.data),
        JSON.stringify(c.counters),
        JSON.stringify(c.participants),
        c.updated_at,
        expectedVersion,
      ],
    );
    return result.rowCount === 1;
  }

  async nextClaimNo(year: number): Promise<string> {
    const { rows } = await this.db.query<{ n: number }>("SELECT nextval('claim_no_seq')::int AS n");
    return `CLM-${year}-${String(rows[0]?.n).padStart(6, '0')}`;
  }

  async list(filter: ClaimFilter = {}): Promise<ClaimSnapshot[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.states?.length) {
      params.push(filter.states);
      where.push(`state = ANY($${params.length})`);
    }
    if (filter.assessorId) {
      params.push(filter.assessorId);
      where.push(`assessor_id = $${params.length}`);
    }
    if (filter.memberId) {
      params.push(filter.memberId);
      where.push(`member_id = $${params.length}`);
    }
    params.push(filter.limit ?? 200);
    const { rows } = await this.db.query(
      `SELECT ${COLUMNS} FROM claims ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC, claim_no DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(rowToClaim);
  }
}
