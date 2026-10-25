import { addDuration, toDate } from './duration';
import { deletePath, getPath, type RuntimeContext, resolveRef, setPath } from './paths';
import { type Effect, isFnCall, type ValueExpr } from './schema';

export type InternalEffect = Extract<Effect, { type: 'set' | 'append' | 'clear' }>;

export function isInternalEffect(effect: Effect): effect is InternalEffect {
  return effect.type === 'set' || effect.type === 'append' || effect.type === 'clear';
}

/** Evaluates a value expression. Objects drop keys whose value is undefined. */
export function evalValue(expr: ValueExpr, ctx: RuntimeContext, newId: () => string): unknown {
  if (expr === null || typeof expr === 'number' || typeof expr === 'boolean') return expr;
  if (typeof expr === 'string') {
    if (expr.startsWith('$$')) return expr.slice(1);
    if (expr === '$uuid') return newId();
    if (expr.startsWith('$')) return structuredClone(resolveRef(ctx, expr));
    return expr;
  }
  if (Array.isArray(expr)) return expr.map((item) => evalValue(item, ctx, newId));
  if (isFnCall(expr)) {
    const [startExpr, durationExpr] = expr.args;
    const start = toDate(evalValue(startExpr as ValueExpr, ctx, newId));
    const duration = evalValue(durationExpr as ValueExpr, ctx, newId);
    if (!start || typeof duration !== 'string') return undefined;
    return addDuration(start, duration).toISOString();
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(expr)) {
    const v = evalValue(value, ctx, newId);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Applies a set/append/clear effect to the claim's `data` object in place. */
export function applyInternalEffect(
  effect: InternalEffect,
  data: Record<string, unknown>,
  ctx: RuntimeContext,
  newId: () => string,
) {
  const segments = effect.path.split('.').slice(1);
  if (effect.type === 'clear') {
    deletePath(data, segments);
    return;
  }
  const value = evalValue(effect.value, ctx, newId);
  if (effect.type === 'set') {
    if (value === undefined || value === null) deletePath(data, segments);
    else setPath(data, segments, value);
    return;
  }
  const current = getPath(data, segments);
  const list = Array.isArray(current) ? [...current] : [];
  if (value !== undefined) list.push(value);
  setPath(data, segments, list);
}
