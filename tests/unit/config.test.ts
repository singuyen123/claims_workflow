import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  ConfigError,
  compileWorkflow,
  loadWorkflowFile,
  loadWorkflowText,
  parseWorkflowObject,
  toMermaid,
  workflowFromStoredContent,
} from '../../src/engine';
import { BASE_CONFIG } from '../helpers/engine-harness';

// biome-ignore lint/suspicious/noExplicitAny: tests poke at raw YAML structures
type Raw = any;

function baseRaw(): Raw {
  return parse(readFileSync(BASE_CONFIG, 'utf8'));
}

function transition(raw: Raw, id: string): Raw {
  const t = raw.transitions.find((x: Raw) => x.id === id);
  if (!t) throw new Error(`no transition ${id}`);
  return t;
}

/** Compiles a mutated copy of the base config and returns the issues it produced. */
function issuesAfter(mutate: (raw: Raw) => void): string[] {
  const raw = baseRaw();
  mutate(raw);
  try {
    compileWorkflow(parseWorkflowObject(raw, 'test'), 'test');
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).issues.map((i) => `${i.path}: ${i.message}`);
  }
  return [];
}

describe('workflow config: loading and hashing', () => {
  it('the shipped config is valid and produces no warnings', () => {
    const wf = loadWorkflowFile(BASE_CONFIG);
    expect(wf.id).toBe('health_claim_reimbursement');
    expect(wf.warnings).toEqual([]);
    expect([...wf.transitions.values()].filter((t) => t.kind === 'move')).toHaveLength(9);
  });

  it('the hash ignores formatting, comments and key order but not content', () => {
    const original = loadWorkflowFile(BASE_CONFIG);
    const raw = baseRaw();
    const reordered = { transitions: raw.transitions, states: raw.states, ...raw };
    const fromJson = loadWorkflowText(`# a comment\n${JSON.stringify(reordered, null, 4)}`, 'json');
    expect(fromJson.hash).toBe(original.hash);

    const changed = baseRaw();
    changed.counters.info_requests.max = 4;
    const other = compileWorkflow(parseWorkflowObject(changed, 'changed'), 'changed');
    expect(other.hash).not.toBe(original.hash);
  });

  it('round-trips through stored content and detects a tampered definition', () => {
    const wf = loadWorkflowFile(BASE_CONFIG);
    const stored = JSON.parse(JSON.stringify(wf.file));
    expect(workflowFromStoredContent(stored, wf.hash, 'db').hash).toBe(wf.hash);
    stored.counters.info_requests.max = 99;
    expect(() => workflowFromStoredContent(stored, wf.hash, 'db')).toThrow(
      /the definition was modified/,
    );
  });

  it('reports YAML syntax errors with a line number', () => {
    expect(() => loadWorkflowText('workflow: {\n  id: x\n', 'broken.yaml')).toThrow(/line \d+/);
  });

  it('generates a Mermaid diagram from the config', () => {
    const diagram = toMermaid(loadWorkflowFile(BASE_CONFIG), {
      current: 'UNDER_ASSESSMENT',
      visited: ['SUBMITTED'],
    });
    expect(diagram).toContain('[*] --> SUBMITTED: submit_claim');
    expect(diagram).toContain(
      'UNDER_ASSESSMENT --> PENDING_INFO: request_info [assessor] (max info_requests)',
    );
    expect(diagram).toContain('class UNDER_ASSESSMENT current');
  });
});

describe('workflow config: static validation', () => {
  it('rejects unknown keys (typos) with the location', () => {
    const issues = issuesAfter((raw) => {
      transition(raw, 'approve').precondition = [];
    });
    expect(issues).toContain("transitions.approve: unknown key 'precondition'");
  });

  it('rejects references to unknown states and roles, with suggestions', () => {
    const issues = issuesAfter((raw) => {
      transition(raw, 'approve').to = 'APROVED';
      transition(raw, 'reject').roles = ['asessor'];
    });
    expect(issues).toContain(
      "transitions.approve.to: unknown state 'APROVED'. Did you mean 'APPROVED'?",
    );
    expect(issues).toContain(
      "transitions.reject.roles: unknown role 'asessor'. Did you mean 'assessor'?",
    );
  });

  it('type-checks every $path and suggests the intended one', () => {
    const issues = issuesAfter((raw) => {
      transition(raw, 'approve').preconditions[2].left = '$claim.assesment.approved_amount';
    });
    expect(issues.join('\n')).toMatch(
      /transitions\.approve\.preconditions\[2\]\.left: \$claim\.assesment\.approved_amount: unknown field 'assesment' in 'claim'\. Did you mean 'assessment'\?/,
    );
  });

  it('rejects inputs a transition does not declare', () => {
    const issues = issuesAfter((raw) => {
      transition(raw, 'request_info').effects[0].value.description = '$input.reson';
    });
    expect(issues.join('\n')).toContain(
      "input 'reson' is not declared in this transition's inputs. Did you mean 'reason'?",
    );
  });

  it('rejects comparisons between incompatible types', () => {
    const issues = issuesAfter((raw) => {
      transition(raw, 'approve').preconditions[2].right = '$claim.created_at';
    });
    expect(issues.join('\n')).toContain(
      'cannot order money ($claim.assessment.approved_amount) and timestamp ($claim.created_at)',
    );
  });

  it('checks enum literals', () => {
    const issues = issuesAfter((raw) => {
      raw.rules.staff_or_own_claim.conditions[0].right = 'membr';
    });
    expect(issues.join('\n')).toContain(
      "'membr' is not a value of enum role. Did you mean 'member'?",
    );
  });

  it('rejects writes of the wrong type and writes to engine-managed columns', () => {
    const issues = issuesAfter((raw) => {
      transition(raw, 'submit_assessment').effects[0].value.approved_amount = '$input.summary';
      transition(raw, 'verify_documents').effects.push({
        type: 'set',
        path: 'claim.state',
        value: 'CLOSED',
      });
    });
    expect(issues.join('\n')).toContain(
      'cannot store text ($input.summary) in a field of type money',
    );
    expect(issues.join('\n')).toContain(
      'claim.state is managed by the engine and cannot be written by effects',
    );
  });

  it('checks template placeholders and filters', () => {
    const issues = issuesAfter((raw) => {
      raw.templates.claim_approved.body =
        'Approved {claim.assessment.approved_amount|date} {claim.nope}';
    });
    const text = issues.join('\n');
    expect(text).toContain(
      "filter 'date' expects date or timestamp, but {claim.assessment.approved_amount} is money",
    );
    expect(text).toContain("{claim.nope}: unknown field 'nope' in 'claim'");
  });

  it('requires every cycle to increment a counter', () => {
    const issues = issuesAfter((raw) => {
      transition(raw, 'request_info').increments = [];
    });
    expect(issues).toContain(
      'transitions: unbounded cycle DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → PENDING_INFO → DOCUMENTS_VERIFIED (transitions: start_assessment, request_info, info_received): add `increments: [<counter>]` to at least one of these transitions',
    );
  });

  it('rejects unreachable and dead-end states', () => {
    const issues = issuesAfter((raw) => {
      raw.states.ON_HOLD = { label: 'On hold' };
      raw.states.ESCALATED = { label: 'Escalated' };
      raw.transitions.push({
        id: 'escalate',
        from: 'UNDER_ASSESSMENT',
        to: 'ESCALATED',
        roles: ['assessor'],
      });
    });
    expect(issues).toContain('states.ON_HOLD: not reachable from the initial state SUBMITTED');
    expect(issues).toContain('states.ESCALATED: cannot reach a terminal state (dead end)');
  });

  it('requires exactly one well-formed creation transition', () => {
    const issues = issuesAfter((raw) => {
      transition(raw, 'submit_claim').from = 'CLOSED';
    });
    expect(issues.join('\n')).toContain(
      'exactly one transition without `from` (the claim-creation transition) is required',
    );
    expect(issues.join('\n')).toContain(
      "'CLOSED' is terminal and cannot have outgoing transitions",
    );
  });

  it('keeps automatic transitions for service accounts', () => {
    const issues = issuesAfter((raw) => {
      transition(raw, 'close_rejected').roles = ['team_lead'];
    });
    expect(issues.join('\n')).toContain('automatic transitions run as the system service account');
  });
});
