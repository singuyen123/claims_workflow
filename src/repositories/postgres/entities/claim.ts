import { EntitySchema } from 'typeorm';
import type { ClaimSnapshot } from '../../../domain/types';
import type { Row } from './columns';

export type ClaimRow = Row<
  ClaimSnapshot,
  'state_entered_at' | 'created_at' | 'updated_at',
  'data' | 'counters' | 'participants'
> & {
  /** Generated from data.assessor_id, for work-queue filters. */
  assessor_id: string | null;
};

export const ClaimEntity = new EntitySchema<ClaimRow>({
  name: 'Claim',
  tableName: 'claims',
  columns: {
    id: { type: 'uuid', primary: true },
    claim_no: { type: 'text' },
    config_hash: { type: 'text' },
    policy_id: { type: 'text' },
    member_id: { type: 'text' },
    claim_type: { type: 'text' },
    claimed_amount: { type: 'bigint' },
    state: { type: 'text' },
    state_entered_at: { type: 'timestamptz' },
    version: { type: 'integer' },
    data: { type: 'jsonb', default: {} },
    counters: { type: 'jsonb', default: {} },
    participants: { type: 'jsonb', default: {} },
    created_at: { type: 'timestamptz' },
    updated_at: { type: 'timestamptz' },
    assessor_id: {
      type: 'text',
      nullable: true,
      generatedType: 'STORED',
      asExpression: "data ->> 'assessor_id'",
      insert: false,
      update: false,
      select: false,
    },
  },
});
