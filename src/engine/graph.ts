import type { TransitionDef } from './schema';

export interface Edge {
  from: string;
  to: string;
  transition: string;
  /** True when the transition increments a counter that has a `max`. */
  bounded: boolean;
}

/** State-changing edges only; creation and in-state actions do not move between states. */
export function buildEdges(
  transitions: readonly TransitionDef[],
  counters: ReadonlySet<string>,
): Edge[] {
  const edges: Edge[] = [];
  for (const t of transitions) {
    if (!t.to || t.from.length === 0) continue;
    const bounded = t.increments.some((c) => counters.has(c));
    for (const from of t.from) edges.push({ from, to: t.to, transition: t.id, bounded });
  }
  return edges;
}

export function reachableFrom(start: string, edges: readonly Edge[]): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const state = queue.shift() as string;
    for (const e of edges) {
      if (e.from === state && !seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return seen;
}

/** States from which at least one of `targets` can be reached. */
export function statesReaching(targets: Iterable<string>, edges: readonly Edge[]): Set<string> {
  const seen = new Set(targets);
  const queue = [...seen];
  while (queue.length) {
    const state = queue.shift() as string;
    for (const e of edges) {
      if (e.to === state && !seen.has(e.from)) {
        seen.add(e.from);
        queue.push(e.from);
      }
    }
  }
  return seen;
}

/**
 * A cycle made only of unbounded edges, or null. Such a cycle could repeat forever, so the
 * validator requires every cycle to pass through a transition that increments a counter.
 */
export function findUnboundedCycle(edges: readonly Edge[]): Edge[] | null {
  const unbounded = edges.filter((e) => !e.bounded);
  const color = new Map<string, 'grey' | 'black'>();
  const stack: Edge[] = [];

  const visit = (state: string): Edge[] | null => {
    color.set(state, 'grey');
    for (const e of unbounded) {
      if (e.from !== state) continue;
      const c = color.get(e.to);
      if (c === 'grey') {
        const start = stack.findIndex((s) => s.from === e.to);
        return [...(start >= 0 ? stack.slice(start) : []), e];
      }
      if (!c) {
        stack.push(e);
        const found = visit(e.to);
        if (found) return found;
        stack.pop();
      }
    }
    color.set(state, 'black');
    return null;
  };

  const states = new Set(unbounded.map((e) => e.from));
  for (const s of states) {
    if (!color.has(s)) {
      const found = visit(s);
      if (found) return found;
    }
  }
  return null;
}

export function shortestPath(from: string, to: string, edges: readonly Edge[]): Edge[] | null {
  if (from === to) return [];
  const previous = new Map<string, Edge>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const state = queue.shift() as string;
    for (const e of edges) {
      if (e.from !== state || seen.has(e.to)) continue;
      seen.add(e.to);
      previous.set(e.to, e);
      if (e.to === to) {
        const path: Edge[] = [];
        let cursor: string | undefined = to;
        while (cursor && cursor !== from) {
          const edge = previous.get(cursor) as Edge;
          path.unshift(edge);
          cursor = edge.from;
        }
        return path;
      }
      queue.push(e.to);
    }
  }
  return null;
}

export function describeCycle(cycle: readonly Edge[]): string {
  const states = [cycle[0]?.from, ...cycle.map((e) => e.to)].join(' → ');
  return `${states} (transitions: ${cycle.map((e) => e.transition).join(', ')})`;
}
