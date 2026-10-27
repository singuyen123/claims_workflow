import type { Policy, User } from '../domain/types';

/** Users are reference data: the runtime role reads them, the seed (owner role) writes them. */
export interface UserRepository {
  list(): Promise<User[]>;
  find(id: string): Promise<User | null>;
}

export interface PolicyRepository {
  find(id: string | undefined): Promise<Policy | null>;
  list(): Promise<Policy[]>;
}
