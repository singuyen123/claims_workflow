import jsonpatch from 'fast-json-patch';
import type { Actor, ClaimSnapshot, JsonPatchOp, Policy, User } from '../domain/types';
import {
  type ConditionEnv,
  dependsOnMissing,
  evaluateCondition,
  inputsReferenced,
  presenceTarget,
} from './conditions';
import { toDate } from './duration';
import { applyInternalEffect, isInternalEffect } from './effects';
import { type Failure, type TransitionHint, WorkflowError } from './errors';
import { shortestPath } from './graph';
import { hashValue } from './hash';
import type { CompiledTransition, CompiledWorkflow, TransitionKind } from './load';
import { lookup, ReadRecorder, type RuntimeContext, resolveRef } from './paths';
import type { Condition, InputDef } from './schema';
import { closest, didYouMean } from './suggest';
import { renderText } from './templates';

export interface EngineEnv {
  now: Date;
  newId: () => string;
}

export interface EvaluateRequest {
  transition_id: string;
  actor: Actor;
  input?: Record<string, unknown>;
  expected_version?: number;
  /** Id and number of the claim that a creation transition will create. */
  new_claim?: { id: string; claim_no: string };
}

export interface EvaluateRefs {
  /** The claim's policy; for creation, the policy named by `input.policy_id` (null if unknown). */
  policy: Policy | null;
  getUser: (id: string) => User | undefined;
}

export interface OutboxDraft {
  effect_type: 'notify' | 'trigger_payment' | 'log';
  payload: Record<string, unknown>;
  idempotency_key: string;
}

export type CheckStage = 'rbac' | 'abac' | 'counter' | 'precondition';

export interface DecisionCheck {
  stage: CheckStage;
  code: string;
  ok: boolean;
}

/** What a decision was based on; stored with every audit entry. */
export interface DecisionContext {
  config_hash: string;
  workflow: { id: string; version: number };
  actor: { user_id: string; role: string; roles_held: string[] };
  reads: Record<string, unknown>;
  checks: DecisionCheck[];
}

export interface TransitionPlan {
  entry_id: string;
  transition_id: string;
  kind: TransitionKind;
  from_state: string | null;
  to_state: string;
  before: ClaimSnapshot | null;
  after: ClaimSnapshot;
  changes: JsonPatchOp[];
  snapshot_hash: string;
  decision_context: DecisionContext;
  reason: string | null;
  notes: string | null;
  /** Normalised inputs, excluding `reason` and `notes` (stored in their own columns). */
  input: Record<string, unknown>;
  outbox: OutboxDraft[];
  effects: Array<Record<string, unknown>>;
  occurred_at: string;
}

export type EvaluateResult =
  | { ok: true; plan: TransitionPlan }
  | { ok: false; error: WorkflowError };

const NOTES_INPUT: InputDef = { type: 'text', required: false, max_length: 2000, label: 'Notes' };

export function claimView(claim: ClaimSnapshot): Record<string, unknown> {
  const { data, ...core } = claim;
  return { ...data, ...core };
}

export function buildContext(
  wf: CompiledWorkflow,
  claim: ClaimSnapshot | null,
  policy: Policy | null,
  actor: Actor,
  input: Record<string, unknown>,
  now: Date,
): RuntimeContext {
  return {
    claim: claim ? claimView(claim) : undefined,
    policy: policy ? { ...policy } : null,
    actor: {
      user_id: actor.user_id,
      role: actor.role,
      member_id: actor.member_id,
      roles_held: actor.roles_held,
    },
    input,
    settings: { ...wf.settings },
    now: now.toISOString(),
  };
}

/** Picks the role a user acts in. Throws when the user is unknown or the role is ambiguous. */
export function resolveActor(
  wf: CompiledWorkflow,
  user: User | undefined,
  userId: string,
  requestedRole?: string,
  transitionId?: string,
): Actor {
  if (!user) throw new WorkflowError('UNKNOWN_USER', `Unknown user '${userId}'`);
  let role = requestedRole;
  if (role) {
    if (!user.roles.includes(role)) {
      throw new WorkflowError(
        'ROLE_NOT_ASSIGNED',
        `User ${user.id} does not hold role '${role}' (holds: ${user.roles.join(', ')})`,
      );
    }
  } else if (user.roles.length === 1) {
    role = user.roles[0];
  } else {
    const transition = transitionId ? wf.transitions.get(transitionId) : undefined;
    const fitting = transition ? user.roles.filter((r) => transition.roles.includes(r)) : [];
    if (fitting.length === 1) role = fitting[0];
    else if (transition && fitting.length === 0) {
      throw new WorkflowError(
        'UNAUTHORIZED_ROLE',
        `None of the roles held by ${user.id} (${user.roles.join(', ')}) can run ${transition.id}. Required: ${transition.roles.join(' or ')}`,
        { transition: transition.id, required_roles: transition.roles },
      );
    } else {
      throw new WorkflowError(
        'ROLE_REQUIRED',
        `User ${user.id} holds several roles (${user.roles.join(', ')}); choose one with --role`,
      );
    }
  }
  return {
    user_id: user.id,
    role: role as string,
    member_id: user.member_id,
    roles_held: user.roles,
    service_account: user.service_account,
  };
}

function hintsFor(wf: CompiledWorkflow, state: string): TransitionHint[] {
  return (wf.outgoing.get(state) ?? []).map((t) => ({
    transition: t.id,
    to: t.to ?? null,
    roles: t.roles,
  }));
}

function describeHints(hints: TransitionHint[]): string {
  if (hints.length === 0) return 'none';
  return hints
    .map((h) => `${h.transition} → ${h.to ?? '(same state)'} [${h.roles.join(', ')}]`)
    .join(', ');
}

function arrow(t: CompiledTransition): string {
  const from = t.from.length ? t.from.join('|') : '(new claim)';
  return `${from} → ${t.to ?? 'same state'}`;
}

function pathTo(wf: CompiledWorkflow, state: string, t: CompiledTransition): string[] | undefined {
  let best: string[] | undefined;
  for (const start of t.from) {
    const path = shortestPath(state, start, wf.edges);
    if (path && (!best || path.length + 1 < best.length)) {
      best = [...path.map((e) => e.transition), t.id];
    }
  }
  return best;
}

// ── inputs ────────────────────────────────────────────────────────────────────────────────────

/** Unknown inputs named in a refusal; the rest are only counted. */
const MAX_UNKNOWN_REPORTED = 5;
/** Characters of an input value or name echoed in a refusal. */
const MAX_ECHO = 60;

/** Cuts text echoed from a request, so a refusal (and its stored copy) stays small. */
function clip(text: string): string {
  if (text.length <= MAX_ECHO) return text;
  // Never end on half of a surrogate pair.
  return `${text.slice(0, MAX_ECHO).replace(/[\uD800-\uDBFF]$/, '')}…`;
}

/** A request value as JSON for a refusal message, cut short. */
function echo(value: unknown): string {
  if (typeof value === 'string') return `"${clip(value)}"`;
  return clip(JSON.stringify(value) ?? String(value));
}

function coerceInput(
  name: string,
  def: InputDef,
  value: unknown,
  wf: CompiledWorkflow,
  refs: EvaluateRefs,
): { value: unknown } | { error: string } {
  const label = `input '${name}'`;
  switch (def.type) {
    case 'text':
    case 'string': {
      if (typeof value !== 'string') return { error: `${label} must be a string` };
      if (def.max_length !== undefined && value.length > def.max_length) {
        return { error: `${label} is longer than ${def.max_length} characters` };
      }
      return { value };
    }
    case 'money':
    case 'integer': {
      const n = typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isSafeInteger(n)) {
        return {
          error: `${label} must be a whole number${def.type === 'money' ? ' of VND' : ''} (got ${echo(value)})`,
        };
      }
      if (def.min !== undefined && n < def.min) return { error: `${label} must be ≥ ${def.min}` };
      if (def.max !== undefined && n > def.max) return { error: `${label} must be ≤ ${def.max}` };
      return { value: n };
    }
    case 'boolean':
      if (typeof value === 'boolean') return { value };
      if (value === 'true' || value === 'false') return { value: value === 'true' };
      return { error: `${label} must be true or false` };
    case 'date':
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && toDate(value)) {
        return { value };
      }
      return {
        error: `${label} must be a date in YYYY-MM-DD format (got ${echo(value)})`,
      };
    case 'timestamp': {
      const date = toDate(value);
      return date
        ? { value: date.toISOString() }
        : { error: `${label} must be an ISO-8601 timestamp` };
    }
    case 'enum': {
      const values = wf.enums[def.enum ?? ''] ?? [];
      if (typeof value === 'string' && values.includes(value)) return { value };
      return {
        error: `${label} must be one of ${values.join(', ')} (got ${echo(value)}).${didYouMean(String(value), values)}`,
      };
    }
    case 'user_ref': {
      if (typeof value !== 'string') return { error: `${label} must be a user id` };
      const user = refs.getUser(value);
      if (!user) return { error: `${label}: unknown user '${clip(value)}'` };
      if (def.role && !user.roles.includes(def.role)) {
        return { error: `${label}: user ${value} does not hold role ${def.role}` };
      }
      return { value };
    }
    case 'policy_ref':
      if (typeof value === 'string' && refs.policy?.id === value) return { value };
      return { error: `${label}: unknown policy ${echo(value)}` };
  }
}

function normalizeInputs(
  wf: CompiledWorkflow,
  t: CompiledTransition,
  raw: Record<string, unknown>,
  refs: EvaluateRefs,
): { values: Record<string, unknown>; missing: string[] } {
  const accepted: Record<string, InputDef> = { notes: NOTES_INPUT, ...t.inputs };
  const errors: Array<{ input: string; message: string }> = [];
  // Own keys only: `constructor` or `toString` are unknown inputs, not inherited members.
  const names = Object.keys(accepted);
  const unknown = Object.keys(raw).filter((key) => !Object.hasOwn(accepted, key));
  const more = unknown.length - MAX_UNKNOWN_REPORTED;
  unknown.slice(0, MAX_UNKNOWN_REPORTED).forEach((key, i) => {
    errors.push({
      input: clip(key),
      message:
        `unknown input '${clip(key)}'${i === 0 ? ` (accepted: ${names.join(', ')})` : ''}.` +
        didYouMean(key, names) +
        (i === MAX_UNKNOWN_REPORTED - 1 && more > 0 ? ` ${more} more unknown inputs.` : ''),
    });
  });
  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const [name, def] of Object.entries(accepted)) {
    const value = raw[name];
    if (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '')
    ) {
      if (def.required) missing.push(name);
      continue;
    }
    const result = coerceInput(name, def, value, wf, refs);
    if ('error' in result) errors.push({ input: name, message: result.error });
    else values[name] = result.value;
  }
  if (errors.length) {
    throw new WorkflowError(
      'INVALID_INPUT',
      `Invalid input for ${t.id}: ${errors.map((e) => e.message).join('; ')}`,
      { transition: t.id, input_errors: errors },
    );
  }
  return { values, missing };
}

function inputLabel(t: CompiledTransition, name: string): string {
  return t.inputs[name]?.label ?? name;
}

// ── evaluation ────────────────────────────────────────────────────────────────────────────────

function conditionCode(c: Condition, fallback: string): string {
  return c.code ?? (c.type === 'ref' ? c.ref.toUpperCase() : fallback);
}

interface Checked {
  transition: CompiledTransition;
  ctx: RuntimeContext;
  input: Record<string, unknown>;
  recorder: ReadRecorder;
  checks: DecisionCheck[];
}

/** Runs every check in order and throws the first category of failure. */
function check(
  wf: CompiledWorkflow,
  claim: ClaimSnapshot | null,
  req: EvaluateRequest,
  refs: EvaluateRefs,
  env: EngineEnv,
): Checked {
  const { actor } = req;
  const t = wf.transitions.get(req.transition_id);
  if (!t) {
    const hint = didYouMean(req.transition_id, wf.transitions.keys());
    throw new WorkflowError(
      'UNKNOWN_TRANSITION',
      `Unknown transition '${req.transition_id}'.${hint}`,
      {
        transition: req.transition_id,
        ...(claim ? { state: claim.state, available: hintsFor(wf, claim.state) } : {}),
      },
    );
  }

  if (t.kind === 'create') {
    if (claim) {
      throw new WorkflowError(
        'INVALID_TRANSITION',
        `${t.id} creates a new claim and cannot run on existing claim ${claim.claim_no}`,
        { transition: t.id, claim_no: claim.claim_no, state: claim.state },
      );
    }
  } else {
    if (!claim) {
      throw new WorkflowError('CLAIM_NOT_FOUND', `${t.id} needs an existing claim`, {
        transition: t.id,
      });
    }
    if (wf.isTerminal(claim.state)) {
      throw new WorkflowError(
        'TERMINAL_STATE',
        `Claim ${claim.claim_no} is ${claim.state}, a terminal state: no further transitions are possible`,
        { transition: t.id, claim_no: claim.claim_no, state: claim.state, available: [] },
      );
    }
    if (!t.from.includes(claim.state)) {
      const available = hintsFor(wf, claim.state);
      const path = pathTo(wf, claim.state, t);
      const target = t.to ?? t.from.join('|');
      throw new WorkflowError(
        'INVALID_TRANSITION',
        `'${t.id}' (${arrow(t)}) is not available: claim ${claim.claim_no} is ${claim.state}. ` +
          `Available from ${claim.state}: ${describeHints(available)}.` +
          (path
            ? ` To reach ${target}: ${path.join(' → ')}.`
            : ` ${target} cannot be reached from ${claim.state}.`),
        {
          transition: t.id,
          claim_no: claim.claim_no,
          state: claim.state,
          available,
          ...(path ? { path_to_target: path } : {}),
        },
      );
    }
    if (req.expected_version !== undefined && req.expected_version !== claim.version) {
      throw new WorkflowError(
        'CONCURRENT_MODIFICATION',
        `Claim ${claim.claim_no} was modified concurrently: expected version ${req.expected_version}, current version ${claim.version}. Reload and retry.`,
        {
          claim_no: claim.claim_no,
          expected_version: req.expected_version,
          current_version: claim.version,
        },
      );
    }
  }

  // RBAC
  if (!actor.roles_held.includes(actor.role)) {
    throw new WorkflowError(
      'ROLE_NOT_ASSIGNED',
      `User ${actor.user_id} does not hold role '${actor.role}'`,
      { transition: t.id },
    );
  }
  if (wf.definition.roles[actor.role]?.service_account_only && !actor.service_account) {
    throw new WorkflowError(
      'SERVICE_ACCOUNT_ONLY',
      `Role '${actor.role}' is reserved for service accounts`,
      { transition: t.id },
    );
  }
  const checks: DecisionCheck[] = [];
  const roleOk = t.roles.includes(actor.role);
  checks.push({ stage: 'rbac', code: actor.role, ok: roleOk });
  if (!roleOk) {
    const other = actor.roles_held.filter((r) => t.roles.includes(r));
    throw new WorkflowError(
      'UNAUTHORIZED_ROLE',
      `Role '${actor.role}' cannot run ${t.id} (${arrow(t)}). Required: ${t.roles.join(' or ')}.` +
        (other.length
          ? ` ${actor.user_id} also holds '${other[0]}' — act in that role instead.`
          : ''),
      {
        transition: t.id,
        required_roles: t.roles,
        ...(claim ? { claim_no: claim.claim_no, state: claim.state } : {}),
      },
    );
  }

  const { values: input, missing } = normalizeInputs(wf, t, req.input ?? {}, refs);
  const recorder = new ReadRecorder();
  const ctx = buildContext(wf, claim, refs.policy, actor, input, env.now);
  const condEnv: ConditionEnv = { wf, ctx, claim, getUser: refs.getUser, recorder };

  // ABAC
  for (const c of t.authorization) {
    const outcome = evaluateCondition(c, condEnv);
    checks.push({
      stage: 'abac',
      code: outcome.failures[0]?.code ?? conditionCode(c, 'AUTHORIZATION'),
      ok: outcome.ok,
    });
    if (!outcome.ok) {
      throw new WorkflowError('ACCESS_DENIED', outcome.failures.map((f) => f.message).join('; '), {
        transition: t.id,
        failures: outcome.failures,
        ...(claim ? { claim_no: claim.claim_no, state: claim.state } : {}),
      });
    }
  }

  // Loop counters and the per-claim safety net
  for (const name of t.increments) {
    const counter = wf.definition.counters[name];
    if (!counter) continue;
    const value = claim?.counters[name] ?? 0;
    recorder.record(`claim.counters.${name}`, value);
    checks.push({ stage: 'counter', code: name, ok: value < counter.max });
    if (value >= counter.max) {
      throw new WorkflowError('CYCLE_LIMIT_EXCEEDED', counter.message, {
        transition: t.id,
        counter: { name, value, max: counter.max },
        ...(claim ? { claim_no: claim.claim_no, state: claim.state } : {}),
      });
    }
  }
  const maxActions = wf.definition.limits.max_actions_per_claim;
  if (claim && claim.version >= maxActions) {
    throw new WorkflowError(
      'ACTION_LIMIT_EXCEEDED',
      `Claim ${claim.claim_no} reached the safety limit of ${maxActions} actions`,
      { transition: t.id, claim_no: claim.claim_no },
    );
  }

  // Preconditions (and required inputs). All failures are reported together.
  const failures: Failure[] = missing.map((name) => ({
    code: 'INPUT_REQUIRED',
    message: `${inputLabel(t, name)} is required (input '${name}')`,
    details: { input: name },
  }));
  const missingInputs = new Set(missing);
  const missingPaths = new Set<string>();
  for (const c of t.preconditions) {
    const needs = [...inputsReferenced(c, wf)];
    if (needs.some((n) => missingInputs.has(n)) || dependsOnMissing(c, wf, missingPaths)) continue;
    const outcome = evaluateCondition(c, condEnv);
    checks.push({
      stage: 'precondition',
      code: outcome.failures[0]?.code ?? conditionCode(c, c.type.toUpperCase()),
      ok: outcome.ok,
    });
    if (!outcome.ok) {
      const target = presenceTarget(c, wf);
      if (target) missingPaths.add(target);
    }
    failures.push(...outcome.failures);
  }
  if (failures.length) {
    const subject = claim ? `claim ${claim.claim_no}` : 'a new claim';
    throw new WorkflowError(
      'PRECONDITION_FAILED',
      `Cannot run ${t.id} on ${subject}: ${failures.map((f) => f.message).join('; ')}`,
      {
        transition: t.id,
        failures,
        ...(claim ? { claim_no: claim.claim_no, state: claim.state } : {}),
      },
    );
  }

  return { transition: t, ctx, input, recorder, checks };
}

function recipient(to: string, ctx: RuntimeContext, claim: ClaimSnapshot): Record<string, unknown> {
  if (to === 'member') return { kind: 'member', member_id: claim.member_id };
  if (to.startsWith('role:')) return { kind: 'role', role: to.slice(5) };
  return { kind: 'user', user_id: resolveRef(ctx, to.slice(5)) ?? null };
}

function buildPlan(
  wf: CompiledWorkflow,
  claim: ClaimSnapshot | null,
  req: EvaluateRequest,
  refs: EvaluateRefs,
  env: EngineEnv,
  checked: Checked,
): TransitionPlan {
  const { transition: t, input } = checked;
  const { actor } = req;
  const now = env.now.toISOString();
  const entryId = env.newId();

  let after: ClaimSnapshot;
  if (t.kind === 'create') {
    if (!req.new_claim) throw new Error('new_claim is required for the creation transition');
    after = {
      id: req.new_claim.id,
      claim_no: req.new_claim.claim_no,
      config_hash: wf.hash,
      policy_id: input.policy_id as string,
      member_id: refs.policy?.member_id as string,
      claim_type: input.claim_type as string,
      claimed_amount: input.claimed_amount as number,
      state: t.to as string,
      state_entered_at: now,
      version: 1,
      data: {},
      counters: {},
      participants: {},
      created_at: now,
      updated_at: now,
    };
  } else {
    after = structuredClone(claim as ClaimSnapshot);
    if (t.kind === 'move') {
      after.state = t.to as string;
      after.state_entered_at = now;
    }
    after.version += 1;
    after.updated_at = now;
  }
  for (const name of t.increments) after.counters[name] = (after.counters[name] ?? 0) + 1;
  const performers = after.participants[t.id] ?? [];
  if (!performers.includes(actor.user_id))
    after.participants[t.id] = [...performers, actor.user_id];

  const effects: Array<Record<string, unknown>> = [];
  for (const effect of t.effects) {
    if (!isInternalEffect(effect)) continue;
    const ctx = buildContext(wf, after, refs.policy, actor, input, env.now);
    applyInternalEffect(effect, after.data, ctx, env.newId);
    effects.push({ type: effect.type, path: effect.path });
  }

  // External effects see the final state of the claim. Each one's audit record carries the hash
  // of its outbox payload, so the chained entry vouches for what the worker will deliver.
  const finalCtx = buildContext(wf, after, refs.policy, actor, input, env.now);
  const text = (template: string) => renderText(template, (path) => lookup(finalCtx, path));
  const outbox: OutboxDraft[] = [];
  t.effects.forEach((effect, index) => {
    if (effect.type === 'notify') {
      const tpl = wf.definition.templates[effect.template];
      if (!tpl) return;
      const key = `notify:${entryId}:${index}`;
      const payload = {
        template: effect.template,
        channel: tpl.channel,
        to: recipient(tpl.to, finalCtx, after),
        subject: tpl.subject ? text(tpl.subject) : null,
        body: text(tpl.body),
        claim_id: after.id,
        claim_no: after.claim_no,
      };
      outbox.push({ effect_type: 'notify', idempotency_key: key, payload });
      effects.push({
        type: 'notify',
        template: effect.template,
        idempotency_key: key,
        payload_hash: hashValue(payload),
      });
    } else if (effect.type === 'trigger_payment') {
      const reference = resolveRef(finalCtx, effect.reference);
      const key = `payment:${after.id}:${String(reference)}`;
      const payload = {
        claim_id: after.id,
        claim_no: after.claim_no,
        amount: resolveRef(finalCtx, effect.amount),
        currency: 'VND',
        reference,
      };
      outbox.push({ effect_type: 'trigger_payment', idempotency_key: key, payload });
      effects.push({
        type: 'trigger_payment',
        idempotency_key: key,
        payload_hash: hashValue(payload),
      });
    } else if (effect.type === 'log') {
      const key = `log:${entryId}:${index}`;
      const payload = {
        message: text(effect.message),
        claim_id: after.id,
        claim_no: after.claim_no,
      };
      outbox.push({ effect_type: 'log', idempotency_key: key, payload });
      effects.push({ type: 'log', idempotency_key: key, payload_hash: hashValue(payload) });
    }
  });

  const { reason, notes, ...otherInput } = input;
  return {
    entry_id: entryId,
    transition_id: t.id,
    kind: t.kind,
    from_state: claim ? claim.state : null,
    to_state: after.state,
    before: claim,
    after,
    changes: jsonpatch.compare(claim ?? {}, after) as JsonPatchOp[],
    snapshot_hash: hashValue(after),
    decision_context: {
      config_hash: wf.hash,
      workflow: { id: wf.id, version: wf.version },
      actor: { user_id: actor.user_id, role: actor.role, roles_held: actor.roles_held },
      reads: Object.fromEntries(checked.recorder.reads),
      checks: checked.checks,
    },
    reason: typeof reason === 'string' ? reason : null,
    notes: typeof notes === 'string' ? notes : null,
    input: otherInput,
    outbox,
    effects,
    occurred_at: now,
  };
}

/** Pure decision function: either a plan to persist, or the reason the action is refused. */
export function evaluateTransition(
  wf: CompiledWorkflow,
  claim: ClaimSnapshot | null,
  req: EvaluateRequest,
  refs: EvaluateRefs,
  env: EngineEnv,
): EvaluateResult {
  try {
    const checked = check(wf, claim, req, refs, env);
    return { ok: true, plan: buildPlan(wf, claim, req, refs, env, checked) };
  } catch (error) {
    if (error instanceof WorkflowError) return { ok: false, error };
    throw error;
  }
}

// ── dry run ───────────────────────────────────────────────────────────────────────────────────

export interface AvailableCheck {
  stage: CheckStage | 'input';
  code: string;
  ok: boolean;
  message: string;
}

export interface AvailableTransition {
  id: string;
  label: string;
  kind: TransitionKind;
  to: string | null;
  roles: string[];
  automatic: boolean;
  /** The actor's role may run this transition. */
  role_ok: boolean;
  /** Role, authorization, counters and preconditions all pass (inputs aside). */
  allowed: boolean;
  inputs: Array<{ name: string } & InputDef & { values?: readonly string[] }>;
  checks: AvailableCheck[];
}

/** Evaluates every transition available in the claim's state without changing anything. */
export function availableTransitions(
  wf: CompiledWorkflow,
  claim: ClaimSnapshot,
  actor: Actor,
  refs: EvaluateRefs,
  env: EngineEnv,
): AvailableTransition[] {
  if (wf.isTerminal(claim.state)) return [];
  const ctx = buildContext(wf, claim, refs.policy, actor, {}, env.now);
  const condEnv: ConditionEnv = { wf, ctx, claim, getUser: refs.getUser };
  return (wf.outgoing.get(claim.state) ?? []).map((t) => {
    const checks: AvailableCheck[] = [];
    const roleOk = t.roles.includes(actor.role) && actor.roles_held.includes(actor.role);
    checks.push({
      stage: 'rbac',
      code: roleOk ? 'ROLE_OK' : 'UNAUTHORIZED_ROLE',
      ok: roleOk,
      message: roleOk ? `role ${actor.role}` : `requires ${t.roles.join(' or ')}`,
    });
    const inputNames = new Set(Object.keys(t.inputs));
    const missingPaths = new Set<string>();
    const evaluate = (c: Condition, stage: CheckStage) => {
      const needs = [...inputsReferenced(c, wf)].filter((n) => inputNames.has(n));
      if (needs.length) {
        checks.push({
          stage: 'input',
          code: 'NEEDS_INPUT',
          ok: true,
          message: `checked when ${needs.join(', ')} is provided`,
        });
        return;
      }
      if (dependsOnMissing(c, wf, missingPaths)) return;
      const outcome = evaluateCondition(c, condEnv);
      checks.push({
        stage,
        code: outcome.failures[0]?.code ?? conditionCode(c, c.type.toUpperCase()),
        ok: outcome.ok,
        message: outcome.ok ? 'ok' : outcome.failures.map((f) => f.message).join('; '),
      });
      if (!outcome.ok && stage === 'precondition') {
        const target = presenceTarget(c, wf);
        if (target) missingPaths.add(target);
      }
    };
    for (const c of t.authorization) evaluate(c, 'abac');
    for (const name of t.increments) {
      const counter = wf.definition.counters[name];
      if (!counter) continue;
      const value = claim.counters[name] ?? 0;
      checks.push({
        stage: 'counter',
        code: value < counter.max ? name : 'CYCLE_LIMIT_EXCEEDED',
        ok: value < counter.max,
        message: value < counter.max ? `${name} ${value}/${counter.max}` : counter.message,
      });
    }
    for (const c of t.preconditions) evaluate(c, 'precondition');
    return {
      id: t.id,
      label: t.label ?? t.id,
      kind: t.kind,
      to: t.to ?? null,
      roles: t.roles,
      automatic: t.automatic,
      role_ok: roleOk,
      allowed: checks.every((c) => c.ok),
      inputs: [
        ...Object.entries(t.inputs).map(([name, def]) => ({
          name,
          ...def,
          ...(def.type === 'enum' ? { values: wf.enums[def.enum ?? ''] ?? [] } : {}),
        })),
        { name: 'notes', ...NOTES_INPUT },
      ],
      checks,
    };
  });
}

/** Closest transition id, for CLI suggestions. */
export function suggestTransition(wf: CompiledWorkflow, id: string): string | undefined {
  return closest(id, wf.transitions.keys());
}
