/** Runtime values a transition can reference (`$claim`, `$policy`, `$actor`, `$input`, …). */
export interface RuntimeContext {
  claim?: Record<string, unknown>;
  policy?: Record<string, unknown> | null;
  actor: { user_id: string; role: string; member_id: string | null; roles_held: string[] };
  input: Record<string, unknown>;
  settings: Record<string, unknown>;
  now: string;
}

/** Records the values conditions read, for the audit entry's `decision_context`. */
export class ReadRecorder {
  readonly reads = new Map<string, unknown>();

  record(path: string, value: unknown) {
    if (!this.reads.has(path)) this.reads.set(path, value === undefined ? null : value);
  }
}

export function getPath(root: unknown, segments: readonly string[]): unknown {
  let current = root;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Value of a dotted path such as `claim.assessment.summary` (no leading `$`). */
export function lookup(ctx: RuntimeContext, dotted: string): unknown {
  return getPath(ctx, dotted.split('.'));
}

/** Value of a `$path` reference. `$uuid` is only meaningful in effects and is handled there. */
export function resolveRef(ctx: RuntimeContext, ref: string, recorder?: ReadRecorder): unknown {
  const dotted = ref.slice(1);
  const value = lookup(ctx, dotted);
  recorder?.record(dotted, value);
  return value;
}

export function setPath(
  target: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
) {
  let current = target;
  segments.slice(0, -1).forEach((segment) => {
    const next = current[segment];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  });
  current[segments[segments.length - 1] as string] = value;
}

export function deletePath(target: Record<string, unknown>, segments: readonly string[]) {
  const parent = getPath(target, segments.slice(0, -1));
  if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
    delete (parent as Record<string, unknown>)[segments[segments.length - 1] as string];
  }
}

export function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
