import type { EntityManager } from 'typeorm';
import type { Policy, User } from '../../domain/types';
import type { PolicyRepository, UserRepository } from '../reference-repository';
import { PolicyEntity } from './entities/policy';
import { UserEntity } from './entities/user';

const toUser = (r: User): User => ({
  id: r.id,
  display_name: r.display_name,
  roles: r.roles,
  member_id: r.member_id ?? null,
  service_account: r.service_account,
});

const toPolicy = (r: Policy): Policy => ({
  id: r.id,
  member_id: r.member_id,
  product: r.product,
  coverage_limit: r.coverage_limit,
  currency: r.currency,
  effective_from: r.effective_from,
  effective_to: r.effective_to,
});

export class PgUserRepository implements UserRepository {
  constructor(private readonly manager: EntityManager) {}

  async list(): Promise<User[]> {
    const rows = await this.manager.getRepository(UserEntity).find({ order: { id: 'ASC' } });
    return rows.map(toUser);
  }

  async find(id: string): Promise<User | null> {
    const row = await this.manager.getRepository(UserEntity).findOneBy({ id });
    return row ? toUser(row) : null;
  }
}

export class PgPolicyRepository implements PolicyRepository {
  constructor(private readonly manager: EntityManager) {}

  private get repo() {
    return this.manager.getRepository(PolicyEntity);
  }

  async find(id: string | undefined): Promise<Policy | null> {
    if (!id) return null;
    const row = await this.repo.findOneBy({ id });
    return row ? toPolicy(row) : null;
  }

  async list(): Promise<Policy[]> {
    return (await this.repo.find({ order: { id: 'ASC' } })).map(toPolicy);
  }
}
