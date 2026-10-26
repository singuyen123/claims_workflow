import type { ClaimSnapshot, DefinitionSummary, User } from '../domain/types';
import type { AvailableTransition } from '../engine/engine';
import {
  type CompiledWorkflow,
  ConfigError,
  loadWorkflowFile,
  workflowFromStoredContent,
} from '../engine/load';
import { toMermaid } from '../engine/mermaid';
import type { DefinitionRepository } from '../repositories/definition-repository';
import type { Clock } from './clock';

/** An input as forms need it: its definition, plus the allowed values of an enum. */
export type InputField = AvailableTransition['inputs'][number];

function inputFields(
  wf: CompiledWorkflow,
  inputs: CompiledWorkflow['creation']['inputs'],
): InputField[] {
  return Object.entries(inputs).map(([name, def]) => ({
    name,
    ...def,
    ...(def.type === 'enum' ? { values: wf.enums[def.enum ?? ''] ?? [] } : {}),
  }));
}

export interface CreationForm {
  id: string;
  inputs: InputField[];
  /** The first creation role the user holds; null when the user cannot submit claims. */
  acting_role: string | null;
}

/**
 * Keeps every workflow definition a claim may be pinned to. New claims use `current`; existing
 * claims are always evaluated with the definition stored under their own `config_hash`.
 */
export class WorkflowService {
  private readonly cache = new Map<string, CompiledWorkflow>();

  constructor(
    readonly current: CompiledWorkflow,
    private readonly store: DefinitionRepository,
    private readonly clock: Clock,
  ) {
    this.cache.set(current.hash, current);
  }

  /**
   * Stores the current definition (call once at startup). Changing a workflow without bumping
   * `workflow.version` is refused, so a version number always identifies exactly one definition.
   */
  async register(): Promise<'registered' | 'known'> {
    const wf = this.current;
    const existing = await this.store.findByVersion(wf.id, wf.version);
    if (existing && existing.config_hash !== wf.hash)
      throw this.versionNotBumped(existing.config_hash);
    if (existing) return 'known';
    if (await this.store.insert(wf, this.clock.now())) return 'registered';
    const winner = await this.store.findByVersion(wf.id, wf.version);
    if (winner && winner.config_hash !== wf.hash) throw this.versionNotBumped(winner.config_hash);
    return 'known';
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

  /**
   * The definition stored under `hash`. Pass the transaction's repository when called inside
   * one, so a cache miss does not need a second connection.
   */
  async get(hash: string, definitions: DefinitionRepository): Promise<CompiledWorkflow> {
    const cached = this.cache.get(hash);
    if (cached) return cached;
    const wf = await this.loadFrom(definitions, hash);
    this.cache.set(hash, wf);
    return wf;
  }

  /** The definition a claim is pinned to. */
  workflowFor(claim: ClaimSnapshot): Promise<CompiledWorkflow> {
    return this.get(claim.config_hash, this.store);
  }

  /** Reloads a definition from the database (bypassing the cache) and checks its hash. */
  loadStored(hash: string): Promise<CompiledWorkflow> {
    return this.loadFrom(this.store, hash);
  }

  private async loadFrom(definitions: DefinitionRepository, hash: string) {
    const stored = await definitions.find(hash);
    if (!stored) throw new Error(`Workflow definition ${hash} is not registered`);
    return workflowFromStoredContent(
      stored.content,
      hash,
      `workflow_definitions[${hash.slice(0, 12)}]`,
    );
  }

  /** Registered definitions; `current` marks the one new claims use. */
  async definitions(): Promise<Array<DefinitionSummary & { current: boolean }>> {
    return (await this.store.list()).map((d) => ({
      ...d,
      current: d.config_hash === this.current.hash,
    }));
  }

  health() {
    return {
      ok: true,
      workflow: {
        id: this.current.id,
        version: this.current.version,
        config_hash: this.current.hash,
      },
    };
  }

  /** What the UI needs to render forms and labels without knowing the workflow. */
  describe(wf: CompiledWorkflow = this.current) {
    const d = wf.definition;
    return {
      id: wf.id,
      version: wf.version,
      label: d.workflow.label ?? wf.id,
      config_hash: wf.hash,
      states: Object.entries(d.states).map(([name, s]) => ({ name, ...s })),
      roles: Object.entries(d.roles).map(([name, r]) => ({ name, ...r })),
      counters: Object.entries(d.counters).map(([name, c]) => ({ name, max: c.max })),
      document_requirements: d.document_requirements,
      creation: {
        id: wf.creation.id,
        label: wf.creation.label ?? wf.creation.id,
        roles: wf.creation.roles,
        inputs: inputFields(wf, wf.creation.inputs),
      },
      transitions: [...wf.transitions.values()].map((t) => ({
        id: t.id,
        label: t.label ?? t.id,
        kind: t.kind,
        from: t.from,
        to: t.to ?? null,
        roles: t.roles,
        automatic: t.automatic,
      })),
      diagram: toMermaid(wf),
    };
  }

  /** The creation transition's form, and the role `user` would submit a claim in. */
  creationForm(user?: User): CreationForm {
    const t = this.current.creation;
    return {
      id: t.id,
      inputs: inputFields(this.current, t.inputs),
      acting_role: t.roles.find((r) => user?.roles.includes(r)) ?? null,
    };
  }
}

// ── workflow files (no database) ─────────────────────────────────────────────────────────────

/** Loads and fully validates a workflow file; throws ConfigError when it is invalid. */
export function validateWorkflowFile(source: string) {
  const workflow = loadWorkflowFile(source);
  return {
    workflow,
    summary: {
      ok: true,
      source,
      workflow: workflow.id,
      version: workflow.version,
      config_hash: workflow.hash,
      warnings: workflow.warnings,
    },
  };
}

/** Mermaid state diagram of a workflow file. */
export function workflowFileDiagram(source: string, options: { roles?: boolean } = {}): string {
  return toMermaid(loadWorkflowFile(source), options);
}
