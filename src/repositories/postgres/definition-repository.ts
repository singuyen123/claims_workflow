import type { DefinitionSummary, StoredDefinition } from '../../domain/types';
import type { CompiledWorkflow } from '../../engine/load';
import type { Db } from '../../infra/db/pool';
import type { DefinitionRepository } from '../definition-repository';
import { iso } from './rows';

export class PgDefinitionRepository implements DefinitionRepository {
  constructor(private readonly db: Db) {}

  async find(hash: string): Promise<StoredDefinition | null> {
    const { rows } = await this.db.query(
      'SELECT config_hash, workflow_id, version, content, registered_at FROM workflow_definitions WHERE config_hash = $1',
      [hash],
    );
    return rows[0] ? { ...rows[0], registered_at: iso(rows[0].registered_at) } : null;
  }

  async findByVersion(workflowId: string, version: number): Promise<StoredDefinition | null> {
    const { rows } = await this.db.query(
      `SELECT config_hash, workflow_id, version, content, registered_at
         FROM workflow_definitions WHERE workflow_id = $1 AND version = $2`,
      [workflowId, version],
    );
    return rows[0] ? { ...rows[0], registered_at: iso(rows[0].registered_at) } : null;
  }

  async insert(wf: CompiledWorkflow, now: Date): Promise<boolean> {
    try {
      const r = await this.db.query(
        `INSERT INTO workflow_definitions (config_hash, workflow_id, version, content, registered_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (config_hash) DO NOTHING`,
        [wf.hash, wf.id, wf.version, JSON.stringify(wf.file), now.toISOString()],
      );
      return r.rowCount === 1;
    } catch (error) {
      // Another process registered this workflow version first (with whatever hash it has).
      if ((error as { constraint?: string }).constraint === 'workflow_definitions_version_unique')
        return false;
      throw error;
    }
  }

  async list(): Promise<DefinitionSummary[]> {
    const { rows } = await this.db.query(
      `SELECT config_hash, workflow_id, version, registered_at FROM workflow_definitions
        ORDER BY workflow_id, version`,
    );
    return rows.map((r) => ({ ...r, registered_at: iso(r.registered_at) }));
  }
}
