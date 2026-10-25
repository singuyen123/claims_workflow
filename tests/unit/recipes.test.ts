import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compileWorkflow, parseWorkflowObject } from '../../src/engine';
import { BASE_CONFIG } from '../helpers/engine-harness';

const DOC = 'docs/extending-the-workflow.md';

// biome-ignore lint/suspicious/noExplicitAny: partial workflow files are merged structurally
type Raw = any;

/** ```yaml blocks preceded by `<!-- recipe: name -->` in the extension guide. */
function recipes(): Array<{ name: string; yaml: string }> {
  const text = readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n');
  const blocks = text.matchAll(/<!-- recipe: ([a-z0-9-]+) -->\n```yaml\n([\s\S]*?)```/g);
  return [...blocks].map((m) => ({ name: m[1] as string, yaml: m[2] as string }));
}

/** Adds the recipe's sections to the base file; a transition with an existing id replaces it. */
function merge(base: Raw, part: Raw): Raw {
  const out = structuredClone(base);
  for (const [section, value] of Object.entries(part as Record<string, Raw>)) {
    if (section === 'transitions') {
      for (const t of value) {
        const i = out.transitions.findIndex((x: Raw) => x.id === t.id);
        if (i >= 0) out.transitions[i] = t;
        else out.transitions.push(t);
      }
    } else {
      out[section] = { ...out[section], ...value };
    }
  }
  out.workflow.version += 1;
  return out;
}

describe('recipes in docs/extending-the-workflow.md', () => {
  const list = recipes();

  it('the guide contains the recipes', () => {
    expect(list.map((r) => r.name)).toEqual([
      'request-documents',
      'payment-failed',
      'escalation',
      'withdrawal',
    ]);
  });

  for (const recipe of list) {
    it(`${recipe.name} is a valid change to the shipped workflow`, () => {
      const raw = merge(parse(readFileSync(BASE_CONFIG, 'utf8')), parse(recipe.yaml));
      const wf = compileWorkflow(parseWorkflowObject(raw, recipe.name), recipe.name);
      expect(wf.warnings).toEqual([]);
      for (const t of parse(recipe.yaml).transitions ?? [])
        expect(wf.transitions.has(t.id)).toBe(true);
    });
  }
});
