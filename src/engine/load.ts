import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import type { z } from 'zod';
import { buildEdges, type Edge } from './graph';
import { hashValue } from './hash';
import {
  type TransitionDef,
  type WorkflowDefinition,
  type WorkflowFile,
  workflowFileSchema,
} from './schema';
import { didYouMean } from './suggest';
import { type ConfigIssue, validateDefinition } from './validate';

export type TransitionKind = 'create' | 'move' | 'stay';

export interface CompiledTransition extends TransitionDef {
  kind: TransitionKind;
}

export interface CompiledWorkflow {
  /** Normalised file content; this exact object is stored in `workflow_definitions.content`. */
  readonly file: WorkflowFile;
  readonly definition: WorkflowDefinition;
  /** SHA-256 of the canonical JSON of `file`. */
  readonly hash: string;
  readonly id: string;
  readonly version: number;
  readonly enums: Readonly<Record<string, readonly string[]>>;
  readonly transitions: ReadonlyMap<string, CompiledTransition>;
  readonly creation: CompiledTransition;
  /** Transitions that may run while a claim is in the given state. */
  readonly outgoing: ReadonlyMap<string, readonly CompiledTransition[]>;
  readonly edges: readonly Edge[];
  readonly settings: Readonly<Record<string, string | number | boolean>>;
  readonly warnings: readonly ConfigIssue[];
  isTerminal(state: string): boolean;
}

export class ConfigError extends Error {
  constructor(
    readonly source: string,
    readonly issues: ConfigIssue[],
  ) {
    super(
      `Invalid workflow config ${source}:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`,
    );
    this.name = 'ConfigError';
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function desugarCondition(c: unknown): unknown {
  if (!isObject(c)) return c;
  const out: Record<string, unknown> = { ...c };
  if (!('type' in out) && 'ref' in out) out.type = 'ref';
  if (Array.isArray(out.conditions)) out.conditions = out.conditions.map(desugarCondition);
  if ('condition' in out) out.condition = desugarCondition(out.condition);
  return out;
}

/** Expands the `{ ref: rule }` shorthand to `{ type: ref, ref: rule }` in condition positions. */
export function desugar(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const out: Record<string, unknown> = { ...raw };
  if (isObject(out.rules)) {
    out.rules = Object.fromEntries(
      Object.entries(out.rules).map(([k, v]) => [k, desugarCondition(v)]),
    );
  }
  if (Array.isArray(out.transitions)) {
    out.transitions = out.transitions.map((t) => {
      if (!isObject(t)) return t;
      const copy: Record<string, unknown> = { ...t };
      for (const key of ['authorization', 'preconditions']) {
        if (Array.isArray(copy[key])) copy[key] = (copy[key] as unknown[]).map(desugarCondition);
      }
      return copy;
    });
  }
  return out;
}

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current = root;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function formatPath(path: readonly PropertyKey[], raw: unknown): string {
  let out = '';
  path.forEach((key, i) => {
    if (i === 1 && path[0] === 'transitions' && typeof key === 'number') {
      const id = valueAt(raw, ['transitions', key, 'id']);
      out += typeof id === 'string' ? `.${id}` : `[${key}]`;
    } else if (typeof key === 'number') {
      out += `[${key}]`;
    } else {
      out += out ? `.${String(key)}` : String(key);
    }
  });
  return out || '(root)';
}

const CONDITION_TYPES = [
  'field_present',
  'compare',
  'documents_present',
  'received_since_state_entry',
  'duration_elapsed',
  'has_role',
  'not_performed',
  'all_of',
  'any_of',
  'not',
  'ref',
];
const EFFECT_TYPES = ['set', 'append', 'clear', 'notify', 'trigger_payment', 'log'];

function describeIssue(issue: z.core.$ZodIssue, raw: unknown): string {
  if (issue.code === 'invalid_union') {
    const value = valueAt(raw, issue.path);
    const type = isObject(value) ? value.type : undefined;
    if (typeof type === 'string') {
      const known = [...CONDITION_TYPES, ...EFFECT_TYPES];
      return `unknown type '${type}'.${didYouMean(type, known)}`;
    }
    return `invalid value ${JSON.stringify(value)}`;
  }
  if (issue.code === 'unrecognized_keys') {
    return `unknown key${issue.keys.length > 1 ? 's' : ''} ${issue.keys.map((k) => `'${k}'`).join(', ')}`;
  }
  return issue.message;
}

/** Applies schema defaults and turns `from: STATE` into `from: [STATE]`. */
export function parseWorkflowObject(raw: unknown, source: string): WorkflowFile {
  const desugared = desugar(raw);
  const result = workflowFileSchema.safeParse(desugared);
  if (!result.success) {
    throw new ConfigError(
      source,
      result.error.issues.map((issue) => ({
        path: formatPath(issue.path, desugared),
        message: describeIssue(issue, desugared),
      })),
    );
  }
  const file = result.data;
  return {
    ...file,
    transitions: file.transitions.map((t) =>
      typeof t.from === 'string' ? { ...t, from: [t.from] } : t,
    ),
  };
}

export function parseWorkflowText(text: string, source: string): WorkflowFile {
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length) {
    throw new ConfigError(
      source,
      doc.errors.map((e) => ({
        path: e.linePos ? `line ${e.linePos[0].line}, column ${e.linePos[0].col}` : '(yaml)',
        message: e.message.split('\n')[0] ?? e.message,
      })),
    );
  }
  return parseWorkflowObject(doc.toJS(), source);
}

export function toDefinition(file: WorkflowFile): WorkflowDefinition {
  return {
    ...file,
    transitions: file.transitions.map((t) => ({
      ...t,
      from: t.from === undefined ? [] : typeof t.from === 'string' ? [t.from] : t.from,
    })),
  };
}

/** Validates and indexes a parsed workflow. Throws ConfigError listing every problem found. */
export function compileWorkflow(file: WorkflowFile, source: string): CompiledWorkflow {
  const definition = toDefinition(file);
  const { errors, warnings } = validateDefinition(definition);
  if (errors.length) throw new ConfigError(source, errors);

  const transitions = new Map<string, CompiledTransition>();
  const outgoing = new Map<string, CompiledTransition[]>();
  for (const state of Object.keys(definition.states)) outgoing.set(state, []);
  let creation: CompiledTransition | undefined;
  for (const t of definition.transitions) {
    const kind: TransitionKind = t.from.length === 0 ? 'create' : t.to ? 'move' : 'stay';
    const compiled: CompiledTransition = { ...t, kind };
    transitions.set(t.id, compiled);
    if (kind === 'create') creation = compiled;
    for (const from of t.from) outgoing.get(from)?.push(compiled);
  }

  const settings = Object.fromEntries(
    Object.entries(definition.settings).map(([k, s]) => [k, s.value]),
  );
  const terminal = new Set(
    Object.entries(definition.states)
      .filter(([, s]) => s.terminal)
      .map(([name]) => name),
  );

  return {
    file,
    definition,
    hash: hashValue(file),
    id: definition.workflow.id,
    version: definition.workflow.version,
    enums: {
      ...definition.enums,
      claim_type: Object.keys(definition.document_requirements),
    },
    transitions,
    creation: creation as CompiledTransition,
    outgoing,
    edges: buildEdges(definition.transitions, new Set(Object.keys(definition.counters))),
    settings,
    warnings,
    isTerminal: (state) => terminal.has(state),
  };
}

export function loadWorkflowText(text: string, source: string): CompiledWorkflow {
  return compileWorkflow(parseWorkflowText(text, source), source);
}

export function loadWorkflowFile(path: string): CompiledWorkflow {
  return loadWorkflowText(readFileSync(path, 'utf8'), path);
}

/**
 * Rebuilds a workflow from `workflow_definitions.content` and checks it still hashes to the
 * stored value, so a definition edited in the database is detected instead of silently used.
 */
export function workflowFromStoredContent(
  content: unknown,
  expectedHash: string,
  source: string,
): CompiledWorkflow {
  const workflow = compileWorkflow(parseWorkflowObject(content, source), source);
  if (workflow.hash !== expectedHash) {
    throw new ConfigError(source, [
      {
        path: '(definition)',
        message: `stored content hashes to ${workflow.hash}, expected ${expectedHash}: the definition was modified`,
      },
    ]);
  }
  return workflow;
}
