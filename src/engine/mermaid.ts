import type { CompiledWorkflow } from './load';

export interface DiagramOptions {
  /** Highlighted as the claim's current state. */
  current?: string;
  /** States the claim has been through. */
  visited?: Iterable<string>;
  /** Show the roles allowed on each edge (default true). */
  roles?: boolean;
}

/** Mermaid `stateDiagram-v2` generated from the workflow, so docs never drift from the config. */
export function toMermaid(wf: CompiledWorkflow, options: DiagramOptions = {}): string {
  const lines = ['stateDiagram-v2'];
  lines.push(`  [*] --> ${wf.definition.workflow.initial_state}: ${wf.creation.id}`);
  for (const edge of wf.edges) {
    const t = wf.transitions.get(edge.transition);
    const roles = options.roles !== false && t ? ` [${t.roles.join(', ')}]` : '';
    const counter = edge.bounded && t ? ` (max ${t.increments.join(', ')})` : '';
    lines.push(`  ${edge.from} --> ${edge.to}: ${edge.transition}${roles}${counter}`);
  }
  for (const [name, state] of Object.entries(wf.definition.states)) {
    if (state.terminal) lines.push(`  ${name} --> [*]`);
  }
  const visited = new Set(options.visited ?? []);
  if (options.current) visited.delete(options.current);
  if (visited.size || options.current) {
    lines.push('  classDef visited fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a');
    lines.push('  classDef current fill:#2563eb,stroke:#1e40af,color:#ffffff,font-weight:bold');
    if (visited.size) lines.push(`  class ${[...visited].join(',')} visited`);
    if (options.current) lines.push(`  class ${options.current} current`);
  }
  return lines.join('\n');
}
