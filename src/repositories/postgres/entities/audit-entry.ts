import { EntitySchema } from 'typeorm';
import type { AuditEntry } from '../../../domain/types';
import { identity, type Row } from './columns';

export type AuditRow = Row<
  AuditEntry,
  'occurred_at',
  'input' | 'changes' | 'decision_context' | 'effects'
> & { id: number; state_changed: boolean };

export const AuditEntity = new EntitySchema<AuditRow>({
  name: 'AuditEntry',
  tableName: 'audit_log',
  columns: {
    id: { ...identity, select: false },
    entry_id: { type: 'uuid' },
    claim_id: { type: 'uuid' },
    claim_seq: { type: 'integer' },
    transition_id: { type: 'text' },
    from_state: { type: 'text', nullable: true },
    to_state: { type: 'text' },
    state_changed: {
      type: 'boolean',
      nullable: true,
      generatedType: 'STORED',
      asExpression: 'from_state IS DISTINCT FROM to_state',
      insert: false,
      update: false,
      select: false,
    },
    actor_user_id: { type: 'text' },
    actor_role: { type: 'text' },
    reason: { type: 'text', nullable: true },
    notes: { type: 'text', nullable: true },
    input: { type: 'jsonb', default: {} },
    changes: { type: 'jsonb' },
    decision_context: { type: 'jsonb' },
    effects: { type: 'jsonb', default: [] },
    config_hash: { type: 'text' },
    claim_version: { type: 'integer' },
    snapshot_hash: { type: 'text' },
    prev_hash: { type: 'text' },
    hash: { type: 'text' },
    occurred_at: { type: 'timestamptz' },
  },
});
