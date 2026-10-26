import type { Policy, User } from '../../domain/types';
import type { Db } from '../../infra/db/pool';
import type { PolicyRepository, UserRepository } from '../reference-repository';

export class PgUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<User[]> {
    const { rows } = await this.db.query(
      'SELECT id, display_name, roles, member_id, service_account FROM users ORDER BY id',
    );
    return rows.map((r) => ({
      id: r.id,
      display_name: r.display_name,
      roles: r.roles,
      member_id: r.member_id ?? null,
      service_account: r.service_account,
    }));
  }
}

export class PgPolicyRepository implements PolicyRepository {
  constructor(private readonly db: Db) {}

  async find(id: string | undefined): Promise<Policy | null> {
    if (!id) return null;
    const { rows } = await this.db.query(
      `SELECT id, member_id, product, coverage_limit, currency, effective_from, effective_to
         FROM policies WHERE id = $1`,
      [id],
    );
    const r = rows[0];
    return r
      ? {
          id: r.id,
          member_id: r.member_id,
          product: r.product,
          coverage_limit: r.coverage_limit,
          currency: r.currency,
          effective_from: r.effective_from,
          effective_to: r.effective_to,
        }
      : null;
  }

  async list(): Promise<Policy[]> {
    const { rows } = await this.db.query('SELECT id FROM policies ORDER BY id');
    const policies = await Promise.all(rows.map((r) => this.find(r.id as string)));
    return policies.filter((p): p is Policy => p !== null);
  }
}
