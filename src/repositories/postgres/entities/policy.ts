import { EntitySchema } from 'typeorm';
import type { Policy } from '../../../domain/types';

export const PolicyEntity = new EntitySchema<Policy>({
  name: 'Policy',
  tableName: 'policies',
  columns: {
    id: { type: 'text', primary: true },
    member_id: { type: 'text' },
    product: { type: 'text' },
    coverage_limit: { type: 'bigint' },
    currency: { type: 'char', length: 3, default: 'VND' },
    effective_from: { type: 'date' },
    effective_to: { type: 'date' },
  },
});
