import { z } from 'zod';

// Structural schema of a workflow file. Semantic checks (references, graph, path types) live in
// validate.ts; this file only describes shape so that it can also be exported as JSON Schema.

export const IDENT_RE = /^[a-z][a-z0-9_]*$/;
export const STATE_RE = /^[A-Z][A-Z0-9_]*$/;
export const CODE_RE = /^[A-Z][A-Z0-9_]*$/;
/** `$root.segment.segment` — a reference into the evaluation context. */
export const REF_RE = /^\$[a-z_][a-z0-9_]*(\.[a-z0-9_]+)*$/;
/** `claim.segment…` — a writable claim field. */
export const TARGET_RE = /^claim(\.[a-z][a-z0-9_]*)+$/;
export const ISO_DURATION_RE =
  /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/;

const ident = z.string().regex(IDENT_RE, 'must be snake_case (a-z, 0-9, _)');
const stateName = z.string().regex(STATE_RE, 'must be UPPER_SNAKE_CASE');
const errorCode = z.string().regex(CODE_RE, 'must be UPPER_SNAKE_CASE');
const refPath = z.string().regex(REF_RE, 'must be a reference such as $claim.assessor_id');
const targetPath = z
  .string()
  .regex(TARGET_RE, 'must be a claim field path such as claim.documents');
const isoDuration = z.string().regex(ISO_DURATION_RE, 'must be an ISO-8601 duration such as P30D');

/** Literal or `$reference`. A literal string that starts with `$` is written `$$…`. */
export type Operand = string | number | boolean | null | Array<string | number | boolean>;
const operand: z.ZodType<Operand> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

export type ValueExpr =
  | string
  | number
  | boolean
  | null
  | ValueExpr[]
  | { fn: 'add'; args: ValueExpr[] }
  | { [key: string]: ValueExpr };

export function isFnCall(value: unknown): value is { fn: 'add'; args: ValueExpr[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { fn?: unknown }).fn === 'add' &&
    Array.isArray((value as { args?: unknown }).args) &&
    Object.keys(value).length === 2
  );
}

export const valueExprSchema: z.ZodType<ValueExpr> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(valueExprSchema),
    z.strictObject({ fn: z.literal('add'), args: z.array(valueExprSchema).length(2) }),
    z.record(z.string(), valueExprSchema),
  ]),
);

export const COMPARE_OPS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in'] as const;
export type CompareOp = (typeof COMPARE_OPS)[number];

interface ConditionMeta {
  code?: string | undefined;
  message?: string | undefined;
}

export type Condition = ConditionMeta &
  (
    | { type: 'field_present'; path: string }
    | { type: 'compare'; left: Operand; op: CompareOp; right: Operand }
    | { type: 'documents_present' }
    | { type: 'received_since_state_entry'; paths: string[] }
    | { type: 'duration_elapsed'; since: string; duration: string }
    | { type: 'has_role'; user: string; role: string }
    | { type: 'not_performed'; user?: string | undefined; actions: string[] }
    | { type: 'all_of'; conditions: Condition[] }
    | { type: 'any_of'; conditions: Condition[] }
    | { type: 'not'; condition: Condition }
    | { type: 'ref'; ref: string }
  );

const meta = {
  code: errorCode.optional(),
  message: z.string().min(1).optional(),
};

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('field_present'), path: refPath, ...meta }),
    z.strictObject({
      type: z.literal('compare'),
      left: operand,
      op: z.enum(COMPARE_OPS),
      right: operand,
      ...meta,
    }),
    z.strictObject({ type: z.literal('documents_present'), ...meta }),
    z.strictObject({
      type: z.literal('received_since_state_entry'),
      paths: z.array(refPath).min(1),
      ...meta,
    }),
    z.strictObject({
      type: z.literal('duration_elapsed'),
      since: refPath,
      duration: z.union([refPath, isoDuration]),
      ...meta,
    }),
    z.strictObject({ type: z.literal('has_role'), user: refPath, role: ident, ...meta }),
    z.strictObject({
      type: z.literal('not_performed'),
      user: refPath.optional(),
      actions: z.array(ident).min(1),
      ...meta,
    }),
    z.strictObject({
      type: z.literal('all_of'),
      conditions: z.array(conditionSchema).min(1),
      ...meta,
    }),
    z.strictObject({
      type: z.literal('any_of'),
      conditions: z.array(conditionSchema).min(1),
      ...meta,
    }),
    z.strictObject({ type: z.literal('not'), condition: conditionSchema, ...meta }),
    z.strictObject({ type: z.literal('ref'), ref: ident, ...meta }),
  ]),
);

export type Effect =
  | { type: 'set'; path: string; value: ValueExpr }
  | { type: 'append'; path: string; value: ValueExpr }
  | { type: 'clear'; path: string }
  | { type: 'notify'; template: string }
  | { type: 'trigger_payment'; amount: string; reference: string }
  | { type: 'log'; message: string };

export const effectSchema: z.ZodType<Effect> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('set'), path: targetPath, value: valueExprSchema }),
  z.strictObject({ type: z.literal('append'), path: targetPath, value: valueExprSchema }),
  z.strictObject({ type: z.literal('clear'), path: targetPath }),
  z.strictObject({ type: z.literal('notify'), template: ident }),
  z.strictObject({ type: z.literal('trigger_payment'), amount: refPath, reference: refPath }),
  z.strictObject({ type: z.literal('log'), message: z.string().min(1) }),
]);

export const SCALAR_TYPES = [
  'text',
  'string',
  'money',
  'integer',
  'boolean',
  'date',
  'timestamp',
  'duration',
  'uuid',
  'user_ref',
  'policy_ref',
] as const;
export type ScalarType = (typeof SCALAR_TYPES)[number];

export type FieldDef = { description?: string | undefined } & (
  | { type: ScalarType }
  | { type: 'enum'; enum: string }
  | { type: 'object'; fields: Record<string, FieldDef> }
  | { type: 'list'; of: FieldDef }
);

const description = z.string().optional();

export const fieldSchema: z.ZodType<FieldDef> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.strictObject({ type: z.enum(SCALAR_TYPES), description }),
    z.strictObject({ type: z.literal('enum'), enum: ident, description }),
    z.strictObject({
      type: z.literal('object'),
      fields: z.record(ident, fieldSchema),
      description,
    }),
    z.strictObject({ type: z.literal('list'), of: fieldSchema, description }),
  ]),
);

export const INPUT_TYPES = [
  'text',
  'string',
  'money',
  'integer',
  'boolean',
  'date',
  'timestamp',
  'enum',
  'user_ref',
  'policy_ref',
] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const inputSchema = z.strictObject({
  type: z.enum(INPUT_TYPES),
  required: z.boolean().default(false),
  label: z.string().optional(),
  description,
  /** Enum name, for `type: enum`. */
  enum: ident.optional(),
  /** Role the referenced user must hold, for `type: user_ref`. */
  role: ident.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  max_length: z.number().int().positive().optional(),
});
export type InputDef = z.output<typeof inputSchema>;

export const SETTING_TYPES = ['duration', 'money', 'integer', 'string', 'boolean'] as const;
const settingSchema = z.strictObject({
  type: z.enum(SETTING_TYPES),
  value: z.union([z.string(), z.number(), z.boolean()]),
  description,
});
export type SettingDef = z.output<typeof settingSchema>;

/** `member`, `role:<role>` or `user:$path`. */
export const RECIPIENT_RE =
  /^(member|role:[a-z][a-z0-9_]*|user:\$[a-z_][a-z0-9_]*(\.[a-z0-9_]+)*)$/;

const templateSchema = z.strictObject({
  to: z.string().regex(RECIPIENT_RE, 'must be member, role:<role> or user:$path'),
  channel: z.enum(['email', 'sms', 'in_app']).default('email'),
  subject: z.string().optional(),
  body: z.string().min(1),
});
export type TemplateDef = z.output<typeof templateSchema>;

const roleSchema = z.strictObject({
  label: z.string().optional(),
  description,
  /** Only service accounts (e.g. the scheduler) may act in this role. */
  service_account_only: z.boolean().default(false),
});

const stateSchema = z.strictObject({
  label: z.string().optional(),
  description,
  terminal: z.boolean().default(false),
});

export const transitionSchema = z.strictObject({
  id: ident,
  label: z.string().optional(),
  description,
  /** Omitted for the claim-creation transition. */
  from: z.union([stateName, z.array(stateName).min(1)]).optional(),
  /** Omitted for an in-state action (the state does not change). */
  to: stateName.optional(),
  roles: z.array(ident).min(1),
  /** Run by the system service account as soon as its conditions hold. */
  automatic: z.boolean().default(false),
  inputs: z.record(ident, inputSchema).default({}),
  authorization: z.array(conditionSchema).default([]),
  increments: z.array(ident).default([]),
  preconditions: z.array(conditionSchema).default([]),
  effects: z.array(effectSchema).default([]),
});

export const workflowFileSchema = z.strictObject({
  workflow: z.strictObject({
    id: ident,
    version: z.number().int().min(1),
    label: z.string().optional(),
    initial_state: stateName,
  }),
  settings: z.record(ident, settingSchema).default({}),
  limits: z
    .strictObject({ max_actions_per_claim: z.number().int().min(1).default(200) })
    .default({ max_actions_per_claim: 200 }),
  roles: z.record(ident, roleSchema),
  enums: z.record(ident, z.array(ident).min(1)).default({}),
  document_requirements: z.record(ident, z.array(ident)).default({}),
  fields: z.record(ident, fieldSchema).default({}),
  counters: z
    .record(ident, z.strictObject({ max: z.number().int().min(1), message: z.string().min(1) }))
    .default({}),
  rules: z.record(ident, conditionSchema).default({}),
  templates: z.record(ident, templateSchema).default({}),
  states: z.record(stateName, stateSchema),
  transitions: z.array(transitionSchema).min(1),
});

export type WorkflowFile = z.output<typeof workflowFileSchema>;
export type TransitionFile = z.output<typeof transitionSchema>;

/** A transition after normalisation: `from` is always a list (empty for claim creation). */
export interface TransitionDef extends Omit<TransitionFile, 'from'> {
  from: string[];
}

export interface WorkflowDefinition extends Omit<WorkflowFile, 'transitions'> {
  transitions: TransitionDef[];
}
