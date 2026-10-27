import { EntitySchema } from 'typeorm';
import type { DeniedAttempt } from '../../../domain/types';
import { identity, type Row } from './columns';

export type DeniedRow = Row<DeniedAttempt, 'occurred_at', 'details'> & {
  bucket_start: Date | string;
};

export const DeniedEntity = new EntitySchema<DeniedRow>({
  name: 'DeniedAttempt',
  tableName: 'denied_attempts',
  columns: {
    id: identity,
    claim_id: { type: 'uuid', nullable: true },
    actor_user_id: { type: 'text' },
    actor_role: { type: 'text', nullable: true },
    transition_id: { type: 'text' },
    error_code: { type: 'text' },
    message: { type: 'text' },
    details: { type: 'jsonb', default: {} },
    occurred_at: { type: 'timestamptz' },
    bucket_start: { type: 'timestamptz', select: false },
  },
});
