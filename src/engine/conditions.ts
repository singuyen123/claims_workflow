import type { ClaimSnapshot, User } from '../domain/types';
import { addDuration, toDate } from './duration';
import type { Failure } from './errors';
import type { CompiledWorkflow } from './load';
import { isPresent, lookup, type ReadRecorder, type RuntimeContext, resolveRef } from './paths';
import type { CompareOp, Condition, Operand } from './schema';
import { formatDateTime, formatMoney, renderText, stringifyValue } from './templates';

export interface ConditionEnv {
  wf: CompiledWorkflow;
  ctx: RuntimeContext;
  claim: ClaimSnapshot | null;
  getUser: (id: string) => User | undefined;
  recorder?: ReadRecorder;
}

export interface ConditionOutcome {
  ok: boolean;
  failures: Failure[];
}

const PASS: ConditionOutcome = { ok: true, failures: [] };

const OP_WORDS: Record<CompareOp, string> = {
  eq: 'equal to',
  neq: 'different from',
  lt: 'less than',
  lte: 'at most',
  gt: 'greater than',
  gte: 'at least',
  in: 'one of',
};

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

function render(message: string, env: ConditionEnv, locals: Record<string, unknown> = {}): string {
  return renderText(message, (path) => (path in locals ? locals[path] : lookup(env.ctx, path)));
}

function fail(
  c: Condition,
  env: ConditionEnv,
  fallback: { code: string; message: string },
  locals: Record<string, unknown> = {},
  details?: Record<string, unknown>,
): ConditionOutcome {
  const failure: Failure = {
    code: c.code ?? fallback.code,
    message: c.message ? render(c.message, env, locals) : fallback.message,
  };
  if (details) failure.details = details;
  return { ok: false, failures: [failure] };
}

function operandValue(operand: Operand, env: ConditionEnv): unknown {
  if (typeof operand === 'string' && operand.startsWith('$$')) return operand.slice(1);
  if (typeof operand === 'string' && operand.startsWith('$')) {
    return resolveRef(env.ctx, operand, env.recorder);
  }
  return operand;
}

function describeOperand(operand: Operand): string {
  return typeof operand === 'string' && operand.startsWith('$') && !operand.startsWith('$$')
    ? operand.slice(1)
    : JSON.stringify(operand);
}

function displayValue(value: unknown, operand: Operand): string {
  if (
    typeof value === 'number' &&
    typeof operand === 'string' &&
    /amount|limit|threshold/.test(operand)
  ) {
    return formatMoney(value);
  }
  return stringifyValue(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string' && DATE_LIKE.test(a) && DATE_LIKE.test(b)) {
    return toDate(a)?.getTime() === toDate(b)?.getTime();
  }
  return a === b;
}

export function compareValues(op: CompareOp, left: unknown, right: unknown): boolean {
  if (op === 'in') return Array.isArray(right) && right.some((item) => sameValue(left, item));
  if (left === undefined || left === null || right === undefined || right === null) return false;
  if (op === 'eq') return sameValue(left, right);
  if (op === 'neq') return !sameValue(left, right);
  let l: number;
  let r: number;
  if (typeof left === 'number' && typeof right === 'number') {
    l = left;
    r = right;
  } else {
    const ld = toDate(left);
    const rd = toDate(right);
    if (!ld || !rd) return false;
    l = ld.getTime();
    r = rd.getTime();
  }
  switch (op) {
    case 'lt':
      return l < r;
    case 'lte':
      return l <= r;
    case 'gt':
      return l > r;
    case 'gte':
      return l >= r;
  }
}

function evalCompare(
  c: Extract<Condition, { type: 'compare' }>,
  env: ConditionEnv,
): ConditionOutcome {
  const left = operandValue(c.left, env);
  const right = operandValue(c.right, env);
  // A literal null on either side tests presence.
  let ok: boolean;
  if (c.right === null || c.left === null) {
    const other = c.right === null ? left : right;
    ok = c.op === 'eq' ? !isPresent(other) : c.op === 'neq' ? isPresent(other) : false;
  } else {
    ok = compareValues(c.op, left, right);
  }
  if (ok) return PASS;
  const l = displayValue(left, c.left);
  const r = displayValue(right, c.right);
  return fail(
    c,
    env,
    {
      code: 'COMPARISON_FAILED',
      message: `${describeOperand(c.left)} (${l}) must be ${OP_WORDS[c.op]} ${describeOperand(c.right)} (${r})`,
    },
    { left: l, right: r },
  );
}

export function evaluateCondition(c: Condition, env: ConditionEnv): ConditionOutcome {
  switch (c.type) {
    case 'field_present': {
      const value = resolveRef(env.ctx, c.path, undefined);
      const present = isPresent(value);
      env.recorder?.record(`${c.path.slice(1)}?`, present);
      return present
        ? PASS
        : fail(c, env, { code: 'FIELD_MISSING', message: `${c.path.slice(1)} is not set` });
    }

    case 'compare':
      return evalCompare(c, env);

    case 'documents_present': {
      const claim = env.claim;
      const claimType = claim?.claim_type ?? '';
      const required = env.wf.definition.document_requirements[claimType] ?? [];
      const docs = Array.isArray(claim?.data.documents) ? (claim?.data.documents as unknown[]) : [];
      const received = new Set(
        docs.map((d) => (d && typeof d === 'object' ? (d as { type?: unknown }).type : undefined)),
      );
      const missing = required.filter((doc) => !received.has(doc));
      env.recorder?.record('claim.claim_type', claimType);
      env.recorder?.record('claim.documents[].type', [...received].filter(Boolean));
      if (missing.length === 0) return PASS;
      return fail(
        c,
        env,
        {
          code: 'DOCUMENTS_MISSING',
          message: `Missing required documents for ${claimType} claim: ${missing.join(', ')}`,
        },
        { missing: missing.join(', ') },
        { missing },
      );
    }

    case 'received_since_state_entry': {
      const since = env.claim?.state_entered_at;
      const sinceTime = toDate(since)?.getTime() ?? Number.POSITIVE_INFINITY;
      let count = 0;
      for (const ref of c.paths) {
        const items = resolveRef(env.ctx, ref, undefined);
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const at = toDate((item as { received_at?: unknown } | null)?.received_at)?.getTime();
          if (at !== undefined && at > sinceTime) count++;
        }
      }
      env.recorder?.record('claim.state_entered_at', since);
      env.recorder?.record('received_since_state_entry', count);
      if (count > 0) return PASS;
      const sinceText = since ? formatDateTime(since) : 'the last state change';
      return fail(
        c,
        env,
        {
          code: 'NOTHING_NEW_RECEIVED',
          message: `Nothing new has been received since ${sinceText}`,
        },
        { since },
      );
    }

    case 'duration_elapsed': {
      const sinceValue = resolveRef(env.ctx, c.since, env.recorder);
      const since = toDate(sinceValue);
      const duration = c.duration.startsWith('$')
        ? resolveRef(env.ctx, c.duration, env.recorder)
        : c.duration;
      if (!since || typeof duration !== 'string') {
        return fail(c, env, {
          code: 'DURATION_NOT_ELAPSED',
          message: `${c.since.slice(1)} is not set`,
        });
      }
      const deadline = addDuration(since, duration);
      if (new Date(env.ctx.now).getTime() >= deadline.getTime()) return PASS;
      return fail(
        c,
        env,
        {
          code: 'DURATION_NOT_ELAPSED',
          message: `${duration} has not elapsed since ${stringifyValue(sinceValue)} (until ${deadline.toISOString()})`,
        },
        { deadline: deadline.toISOString() },
      );
    }

    case 'has_role': {
      const userId = resolveRef(env.ctx, c.user, env.recorder);
      const user = typeof userId === 'string' ? env.getUser(userId) : undefined;
      if (user?.roles.includes(c.role)) return PASS;
      return fail(
        c,
        env,
        {
          code: 'ROLE_REQUIRED',
          message: `${stringifyValue(userId)} does not hold role ${c.role}`,
        },
        { user: userId },
      );
    }

    case 'not_performed': {
      const userId = resolveRef(env.ctx, c.user ?? '$actor.user_id', env.recorder);
      const participants = env.claim?.participants ?? {};
      const performed = c.actions.filter((a) => participants[a]?.includes(userId as string));
      for (const action of c.actions) {
        env.recorder?.record(`claim.participants.${action}`, participants[action] ?? []);
      }
      if (performed.length === 0) return PASS;
      return fail(
        c,
        env,
        {
          code: 'SOD_VIOLATION',
          message: `${stringifyValue(userId)} already performed ${performed.join(', ')} on this claim (segregation of duties)`,
        },
        { user: userId },
        { performed },
      );
    }

    case 'all_of': {
      const outcomes = c.conditions.map((child) => evaluateCondition(child, env));
      if (outcomes.every((o) => o.ok)) return PASS;
      const failures = outcomes.flatMap((o) => o.failures);
      if (!c.code && !c.message) return { ok: false, failures };
      return fail(c, env, {
        code: failures[0]?.code ?? 'CONDITION_FAILED',
        message: failures.map((f) => f.message).join('; '),
      });
    }

    case 'any_of': {
      const outcomes = c.conditions.map((child) => evaluateCondition(child, env));
      if (outcomes.some((o) => o.ok)) return PASS;
      const failures = outcomes.flatMap((o) => o.failures);
      return fail(
        c,
        env,
        {
          code: 'NONE_SATISFIED',
          message: `None of the alternatives holds: ${failures.map((f) => f.message).join(' / ')}`,
        },
        {},
        { alternatives: failures },
      );
    }

    case 'not': {
      const inner = evaluateCondition(c.condition, env);
      if (!inner.ok) return PASS;
      return fail(c, env, {
        code: 'NEGATION_FAILED',
        message: 'A condition that must not hold does hold',
      });
    }

    case 'ref': {
      const rule = env.wf.definition.rules[c.ref];
      if (!rule) throw new Error(`Unknown rule '${c.ref}'`);
      const outcome = evaluateCondition(rule, env);
      if (outcome.ok || (!c.code && !c.message)) return outcome;
      return fail(c, env, {
        code: outcome.failures[0]?.code ?? 'RULE_FAILED',
        message: outcome.failures.map((f) => f.message).join('; '),
      });
    }
  }
}

/** Every `$path` a condition reads (without the `$`), following rule references. */
export function pathsReferenced(
  c: Condition,
  wf: CompiledWorkflow,
  seen = new Set<string>(),
): Set<string> {
  const paths = new Set<string>();
  const visit = (o: unknown) => {
    if (typeof o === 'string' && o.startsWith('$') && !o.startsWith('$$')) paths.add(o.slice(1));
  };
  const merge = (child: Condition) => {
    for (const p of pathsReferenced(child, wf, seen)) paths.add(p);
  };
  switch (c.type) {
    case 'field_present':
      visit(c.path);
      break;
    case 'compare':
      visit(c.left);
      visit(c.right);
      break;
    case 'duration_elapsed':
      visit(c.since);
      visit(c.duration);
      break;
    case 'has_role':
    case 'not_performed':
      visit(c.user);
      break;
    case 'received_since_state_entry':
      c.paths.forEach(visit);
      break;
    case 'all_of':
    case 'any_of':
      c.conditions.forEach(merge);
      break;
    case 'not':
      merge(c.condition);
      break;
    case 'ref': {
      const rule = wf.definition.rules[c.ref];
      if (rule && !seen.has(c.ref)) {
        seen.add(c.ref);
        merge(rule);
      }
      break;
    }
    default:
      break;
  }
  return paths;
}

/** `$input.x` names a condition depends on. */
export function inputsReferenced(c: Condition, wf: CompiledWorkflow): Set<string> {
  return new Set(
    [...pathsReferenced(c, wf)]
      .filter((p) => p.startsWith('input.'))
      .map((p) => p.split('.')[1] as string),
  );
}

/** The path a `field_present` check (possibly behind a rule reference) tests, if any. */
export function presenceTarget(c: Condition, wf: CompiledWorkflow, depth = 0): string | undefined {
  if (c.type === 'field_present') return c.path.slice(1);
  if (c.type === 'ref' && depth < 10) {
    const rule = wf.definition.rules[c.ref];
    return rule ? presenceTarget(rule, wf, depth + 1) : undefined;
  }
  return undefined;
}

/**
 * True when a condition reads a path already reported missing by an earlier `field_present`
 * check. Such conditions are skipped so a missing amount is reported once ("approved amount is
 * missing"), not again as a misleading comparison ("(not set) exceeds the limit").
 */
export function dependsOnMissing(
  c: Condition,
  wf: CompiledWorkflow,
  missing: ReadonlySet<string>,
): boolean {
  if (missing.size === 0) return false;
  const own = presenceTarget(c, wf);
  for (const path of pathsReferenced(c, wf)) {
    if (path === own) continue;
    for (const m of missing) if (path === m || path.startsWith(`${m}.`)) return true;
  }
  return false;
}
