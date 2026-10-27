import { EntitySchema } from 'typeorm';
import type { IdempotencyRecord } from '../../idempotency-repository';
import type { Row } from './columns';

export type IdempotencyRow = Row<IdempotencyRecord, 'created_at', 'response'>;

export const IdempotencyEntity = new EntitySchema<IdempotencyRow>({
  name: 'IdempotencyKey',
  tableName: 'idempotency_keys',
  columns: {
    key: { type: 'text', primary: true },
    actor_user_id: { type: 'text' },
    request_hash: { type: 'text' },
    claim_id: { type: 'uuid', nullable: true },
    response: { type: 'jsonb' },
    created_at: { type: 'timestamptz' },
  },
});
