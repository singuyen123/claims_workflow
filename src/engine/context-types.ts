import type {
  FieldDef,
  InputDef,
  ScalarType,
  SettingDef,
  TransitionDef,
  WorkflowDefinition,
} from './schema';
import { didYouMean } from './suggest';

export type TypeNode =
  | { kind: 'scalar'; type: ScalarType }
  | { kind: 'enum'; name: string; values: readonly string[] }
  | { kind: 'object'; fields: Record<string, TypeNode> }
  | { kind: 'list'; of: TypeNode };

export type ObjectType = Extract<TypeNode, { kind: 'object' }>;

export const scalar = (type: ScalarType): TypeNode => ({ kind: 'scalar', type });
const object = (fields: Record<string, TypeNode>): ObjectType => ({ kind: 'object', fields });
const list = (of: TypeNode): TypeNode => ({ kind: 'list', of });

/** Claim columns managed by the engine. Config `fields` may not reuse these names. */
export const CORE_CLAIM_FIELDS = [
  'id',
  'claim_no',
  'config_hash',
  'state',
  'state_entered_at',
  'version',
  'member_id',
  'policy_id',
  'claim_type',
  'claimed_amount',
  'created_at',
  'updated_at',
  'counters',
  'participants',
] as const;

/** Enums the engine derives itself; config `enums` may not redefine them. */
export const RESERVED_ENUMS = ['claim_type', 'state', 'role'] as const;

export interface TypeEnv {
  enums: Record<string, readonly string[]>;
  states: readonly string[];
  roles: readonly string[];
  transitionIds: readonly string[];
  counters: readonly string[];
  fields: Record<string, FieldDef>;
  settings: Record<string, SettingDef>;
}

export function buildTypeEnv(def: WorkflowDefinition): TypeEnv {
  return {
    enums: {
      ...def.enums,
      claim_type: Object.keys(def.document_requirements),
      state: Object.keys(def.states),
      role: Object.keys(def.roles),
    },
    states: Object.keys(def.states),
    roles: Object.keys(def.roles),
    transitionIds: def.transitions.map((t) => t.id),
    counters: Object.keys(def.counters),
    fields: def.fields,
    settings: def.settings,
  };
}

function enumType(env: TypeEnv, name: string): TypeNode {
  return { kind: 'enum', name, values: env.enums[name] ?? [] };
}

export function fieldType(def: FieldDef, env: TypeEnv): TypeNode {
  switch (def.type) {
    case 'enum':
      return enumType(env, def.enum);
    case 'object':
      return object(
        Object.fromEntries(Object.entries(def.fields).map(([k, f]) => [k, fieldType(f, env)])),
      );
    case 'list':
      return list(fieldType(def.of, env));
    default:
      return scalar(def.type);
  }
}

export function inputType(def: InputDef, env: TypeEnv): TypeNode {
  return def.type === 'enum' ? enumType(env, def.enum ?? '') : scalar(def.type);
}

export const POLICY_TYPE: ObjectType = object({
  id: scalar('policy_ref'),
  member_id: scalar('string'),
  product: scalar('string'),
  coverage_limit: scalar('money'),
  effective_from: scalar('date'),
  effective_to: scalar('date'),
});

export function claimType(env: TypeEnv): ObjectType {
  const declared = Object.fromEntries(
    Object.entries(env.fields).map(([k, f]) => [k, fieldType(f, env)]),
  );
  return object({
    ...declared,
    id: scalar('uuid'),
    claim_no: scalar('string'),
    config_hash: scalar('string'),
    state: enumType(env, 'state'),
    state_entered_at: scalar('timestamp'),
    version: scalar('integer'),
    member_id: scalar('string'),
    policy_id: scalar('policy_ref'),
    claim_type: enumType(env, 'claim_type'),
    claimed_amount: scalar('money'),
    created_at: scalar('timestamp'),
    updated_at: scalar('timestamp'),
    counters: object(Object.fromEntries(env.counters.map((c) => [c, scalar('integer')]))),
    participants: object(
      Object.fromEntries(env.transitionIds.map((t) => [t, list(scalar('user_ref'))])),
    ),
  });
}

/** Type of everything a transition can reference. */
export function contextType(
  env: TypeEnv,
  transition: TransitionDef | null,
  opts: { claim: boolean; uuid: boolean },
): ObjectType {
  const settingTypes: Record<string, TypeNode> = {};
  for (const [name, setting] of Object.entries(env.settings)) {
    settingTypes[name] = scalar(setting.type === 'string' ? 'string' : setting.type);
  }
  const fields: Record<string, TypeNode> = {
    policy: POLICY_TYPE,
    actor: object({
      user_id: scalar('user_ref'),
      role: enumType(env, 'role'),
      member_id: scalar('string'),
      roles_held: list(enumType(env, 'role')),
    }),
    settings: object(settingTypes),
    now: scalar('timestamp'),
  };
  if (opts.claim) fields.claim = claimType(env);
  if (transition) {
    const inputs: Record<string, TypeNode> = { notes: scalar('text') };
    for (const [name, def] of Object.entries(transition.inputs)) inputs[name] = inputType(def, env);
    fields.input = object(inputs);
  }
  if (opts.uuid) fields.uuid = scalar('uuid');
  return object(fields);
}

export type TypeResult = { ok: true; type: TypeNode } | { ok: false; error: string };

export function typeAtPath(root: TypeNode, segments: readonly string[]): TypeResult {
  let current = root;
  const walked: string[] = [];
  for (const segment of segments) {
    if (current.kind !== 'object') {
      const where = walked.join('.');
      return {
        ok: false,
        error: `'${where}' is ${describeType(current)} and has no field '${segment}'`,
      };
    }
    const next = current.fields[segment];
    if (!next) {
      const where = walked.length ? `'${walked.join('.')}'` : 'the context';
      const hint = didYouMean(segment, Object.keys(current.fields));
      return { ok: false, error: `unknown field '${segment}' in ${where}.${hint}` };
    }
    walked.push(segment);
    current = next;
  }
  return { ok: true, type: current };
}

/** Type of a `$a.b.c` reference. */
export function refType(root: TypeNode, ref: string): TypeResult {
  const result = typeAtPath(root, ref.slice(1).split('.'));
  if (result.ok) return result;
  // A whole-path suggestion only helps when the failing segment had no close match itself.
  const fullHint = result.error.includes('Did you mean') ? '' : suggestFullPath(root, ref);
  return { ok: false, error: `${ref}: ${result.error}${fullHint}` };
}

function suggestFullPath(root: TypeNode, ref: string): string {
  const all: string[] = [];
  const walk = (node: TypeNode, prefix: string) => {
    if (node.kind !== 'object') return;
    for (const [key, child] of Object.entries(node.fields)) {
      const path = prefix ? `${prefix}.${key}` : key;
      all.push(`$${path}`);
      if (all.length < 2000) walk(child, path);
    }
  };
  walk(root, '');
  const hint = didYouMean(ref, all);
  return hint && !hint.includes(`'${ref}'`) ? hint : '';
}

export function describeType(t: TypeNode): string {
  switch (t.kind) {
    case 'scalar':
      return t.type;
    case 'enum':
      return `enum ${t.name}`;
    case 'object':
      return 'an object';
    case 'list':
      return `list<${describeType(t.of)}>`;
  }
}

export const isNumeric = (t: TypeNode) =>
  t.kind === 'scalar' && (t.type === 'money' || t.type === 'integer');
export const isTemporal = (t: TypeNode) =>
  t.kind === 'scalar' && (t.type === 'date' || t.type === 'timestamp');
export const isStringy = (t: TypeNode) =>
  t.kind === 'enum' ||
  (t.kind === 'scalar' && ['text', 'string', 'uuid', 'user_ref', 'policy_ref'].includes(t.type));

/** Can a value of type `src` be stored in a field of type `dst`? */
export function assignable(src: TypeNode, dst: TypeNode): boolean {
  switch (dst.kind) {
    case 'scalar':
      if (src.kind === 'enum') return dst.type === 'text' || dst.type === 'string';
      if (src.kind !== 'scalar') return false;
      if (src.type === dst.type) return true;
      if (isNumeric(src) && isNumeric(dst)) return true;
      return (dst.type === 'text' || dst.type === 'string') && isStringy(src);
    case 'enum':
      return (
        src.kind === 'enum' &&
        (src.name === dst.name || src.values.every((v) => dst.values.includes(v)))
      );
    case 'object':
      return (
        src.kind === 'object' &&
        Object.entries(src.fields).every(([k, t]) => dst.fields[k] && assignable(t, dst.fields[k]))
      );
    case 'list':
      return src.kind === 'list' && assignable(src.of, dst.of);
  }
}

/** Can `a` and `b` be compared for equality? */
export function equatable(a: TypeNode, b: TypeNode): boolean {
  if (isNumeric(a) && isNumeric(b)) return true;
  if (isTemporal(a) && isTemporal(b)) return true;
  if (a.kind === 'enum' && b.kind === 'enum') return a.name === b.name;
  if (isStringy(a) && isStringy(b)) return true;
  return a.kind === 'scalar' && b.kind === 'scalar' && a.type === b.type;
}
