import { EntitySchema } from 'typeorm';
import type { OutboxMessage } from '../../../domain/types';
import { identity, type Json } from './columns';

export type OutboxRow = Omit<
  OutboxMessage,
  'next_attempt_at' | 'locked_until' | 'created_at' | 'processed_at' | 'payload' | 'result'
> & {
  payload: Json;
  result: Json | null;
  next_attempt_at: Date | string;
  locked_until: Date | string | null;
  created_at: Date | string;
  processed_at: Date | string | null;
};

export const OutboxEntity = new EntitySchema<OutboxRow>({
  name: 'OutboxMessage',
  tableName: 'outbox',
  columns: {
    id: identity,
    claim_id: { type: 'uuid' },
    audit_entry_id: { type: 'uuid' },
    effect_type: { type: 'text' },
    payload: { type: 'jsonb' },
    idempotency_key: { type: 'text' },
    status: { type: 'text', default: 'PENDING' },
    attempts: { type: 'integer', default: 0 },
    max_attempts: { type: 'integer', default: 5 },
    next_attempt_at: { type: 'timestamptz' },
    locked_by: { type: 'text', nullable: true },
    locked_until: { type: 'timestamptz', nullable: true },
    last_error: { type: 'text', nullable: true },
    result: { type: 'jsonb', nullable: true },
    created_at: { type: 'timestamptz' },
    processed_at: { type: 'timestamptz', nullable: true },
  },
});
