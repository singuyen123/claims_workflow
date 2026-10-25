import { type CompiledWorkflow, ConfigError, workflowFromStoredContent } from '../engine/load';
import type { Db } from '../infra/db/pool';
import {
  findDefinition,
  findDefinitionByVersion,
  insertDefinition,
} from '../infra/repos/reference';

/**
 * Keeps every workflow definition a claim may be pinned to. New claims use `current`; existing
 * claims are always evaluated with the definition stored under their own `config_hash`.
 */
export class DefinitionRegistry {
  private readonly cache = new Map<string, CompiledWorkflow>();

  constructor(readonly current: CompiledWorkflow) {
    this.cache.set(current.hash, current);
  }

  /**
   * Stores the current definition. Changing a workflow without bumping `workflow.version` is
   * refused, so a version number always identifies exactly one definition.
   */
  async registerCurrent(db: Db, now: Date): Promise<'registered' | 'known'> {
    const wf = this.current;
    const existing = await findDefinitionByVersion(db, wf.id, wf.version);
    if (existing && existing.config_hash !== wf.hash)
      throw this.versionNotBumped(existing.config_hash);
    if (existing) return 'known';
    try {
      await insertDefinition(db, wf, now);
    } catch (error) {
      if ((error as { constraint?: string }).constraint === 'workflow_definitions_version_unique') {
        const winner = await findDefinitionByVersion(db, wf.id, wf.version);
        if (winner && winner.config_hash !== wf.hash)
          throw this.versionNotBumped(winner.config_hash);
        return 'known';
      }
      throw error;
    }
    return 'registered';
  }

  private versionNotBumped(storedHash: string): ConfigError {
    const wf = this.current;
    return new ConfigError(`${wf.id} v${wf.version}`, [
      {
        path: 'workflow.version',
        message: `CONFIG_VERSION_NOT_BUMPED: ${wf.id} v${wf.version} is already registered with hash ${storedHash.slice(0, 12)}…, but this file hashes to ${wf.hash.slice(0, 12)}…. Bump workflow.version when you change the workflow.`,
      },
    ]);
  }

  async get(db: Db, hash: string): Promise<CompiledWorkflow> {
    const cached = this.cache.get(hash);
    if (cached) return cached;
    const wf = await this.loadStored(db, hash);
    this.cache.set(hash, wf);
    return wf;
  }

  /** Reloads a definition from the database (bypassing the cache) and checks its hash. */
  async loadStored(db: Db, hash: string): Promise<CompiledWorkflow> {
    const stored = await findDefinition(db, hash);
    if (!stored) throw new Error(`Workflow definition ${hash} is not registered`);
    return workflowFromStoredContent(
      stored.content,
      hash,
      `workflow_definitions[${hash.slice(0, 12)}]`,
    );
  }
}
