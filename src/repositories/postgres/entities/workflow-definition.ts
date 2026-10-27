import { EntitySchema } from 'typeorm';
import type { StoredDefinition } from '../../../domain/types';
import type { Row } from './columns';

export type DefinitionRow = Row<StoredDefinition, 'registered_at'>;

export const DefinitionEntity = new EntitySchema<DefinitionRow>({
  name: 'WorkflowDefinition',
  tableName: 'workflow_definitions',
  columns: {
    config_hash: { type: 'text', primary: true },
    workflow_id: { type: 'text' },
    version: { type: 'integer' },
    content: { type: 'jsonb' },
    registered_at: { type: 'timestamptz' },
  },
});
