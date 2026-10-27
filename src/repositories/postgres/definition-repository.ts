import type { EntityManager } from 'typeorm';
import type { DefinitionSummary, StoredDefinition } from '../../domain/types';
import type { CompiledWorkflow } from '../../engine/load';
import type { DefinitionRepository } from '../definition-repository';
import { DefinitionEntity, type DefinitionRow } from './entities/workflow-definition';
import { iso } from './rows';

const toDefinition = (r: DefinitionRow): StoredDefinition => ({
  config_hash: r.config_hash,
  workflow_id: r.workflow_id,
  version: r.version,
  content: r.content,
  registered_at: iso(r.registered_at),
});

export class PgDefinitionRepository implements DefinitionRepository {
  constructor(private readonly manager: EntityManager) {}

  private get repo() {
    return this.manager.getRepository(DefinitionEntity);
  }

  async find(hash: string): Promise<StoredDefinition | null> {
    const row = await this.repo.findOneBy({ config_hash: hash });
    return row ? toDefinition(row) : null;
  }

  async findByVersion(workflowId: string, version: number): Promise<StoredDefinition | null> {
    const row = await this.repo.findOneBy({ workflow_id: workflowId, version });
    return row ? toDefinition(row) : null;
  }

  async insert(wf: CompiledWorkflow, now: Date): Promise<boolean> {
    // ON CONFLICT DO NOTHING without a target also covers workflow_definitions_version_unique:
    // when another process registered this version first, nothing is inserted.
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .values({
        config_hash: wf.hash,
        workflow_id: wf.id,
        version: wf.version,
        content: wf.file,
        registered_at: now.toISOString(),
      })
      .orIgnore()
      .returning('config_hash')
      .updateEntity(false)
      .execute();
    return (result.raw as unknown[]).length === 1;
  }

  async list(): Promise<DefinitionSummary[]> {
    const rows = await this.repo.find({
      select: { config_hash: true, workflow_id: true, version: true, registered_at: true },
      order: { workflow_id: 'ASC', version: 'ASC' },
    });
    return rows.map((r) => ({
      config_hash: r.config_hash,
      workflow_id: r.workflow_id,
      version: r.version,
      registered_at: iso(r.registered_at),
    }));
  }
}
