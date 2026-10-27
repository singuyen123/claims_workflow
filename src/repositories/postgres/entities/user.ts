import { EntitySchema } from 'typeorm';
import type { User } from '../../../domain/types';

export const UserEntity = new EntitySchema<User>({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: 'text', primary: true },
    display_name: { type: 'text' },
    roles: { type: 'text', array: true },
    member_id: { type: 'text', nullable: true },
    service_account: { type: 'boolean', default: false },
  },
});
