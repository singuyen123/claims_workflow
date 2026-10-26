import type { DefinitionSummary, StoredDefinition } from '../domain/types';
import type { CompiledWorkflow } from '../engine/load';

/** Every workflow definition a claim may be pinned to, keyed by config hash. */
export interface DefinitionRepository {
  find(hash: string): Promise<StoredDefinition | null>;
  findByVersion(workflowId: string, version: number): Promise<StoredDefinition | null>;
  /**
   * Stores a definition. Returns false when it is not stored by this call: the same hash is
   * already there, or another process registered the same workflow version first.
   */
  insert(wf: CompiledWorkflow, now: Date): Promise<boolean>;
  list(): Promise<DefinitionSummary[]>;
}
