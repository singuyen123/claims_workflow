import type { AuditEntry, ClaimSnapshot, DeniedAttempt } from '../domain/types';
import { formatDateTime } from '../engine/templates';
import type { VerifyReport } from '../services/verify';
import type { ScenarioRun, StepRecord } from './harness';
import type { Scenario } from './scenarios';

export interface ClaimTrail {
  scenario: number;
  claim: ClaimSnapshot;
  workflow_version: number;
  entries: AuditEntry[];
  verify: VerifyReport;
}

export interface ScenarioResult {
  scenario: Scenario;
  run: ScenarioRun;
  trails: ClaimTrail[];
}

export interface ReportMeta {
  clock_start: string;
  base: { id: string; version: number; hash: string; source: string };
  extension: { id: string; version: number; hash: string; source: string };
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const code = (text: string) => `\`${text}\``;
const when = (iso: string) => formatDateTime(iso).replace(' ICT', '');

function actorLabel(step: StepRecord): string {
  if (!step.actor) return '';
  return step.role ? `${step.actor} (${step.role})` : step.actor;
}

function outcome(step: StepRecord): string {
  const lines: string[] = [];
  if (step.error) {
    const verdict = step.ok ? '✗ refused (expected)' : '‼ UNEXPECTED refusal';
    lines.push(`${verdict}: **${step.error.code}** — ${step.error.message}`);
  } else if (step.kind === 'action') {
    lines.push(step.ok ? `✓ ${step.outcome}` : `‼ ${step.outcome}`);
  } else {
    lines.push(step.ok ? step.outcome : `‼ ${step.outcome}`);
  }
  for (const a of step.automatic) lines.push(`⚙ automatic: ${a}`);
  for (const e of step.effects) lines.push(`↳ ${e}`);
  return cell(lines.join('\n'));
}

function inputSummary(input: Record<string, unknown> | undefined): string {
  if (!input || Object.keys(input).length === 0) return '';
  return Object.entries(input)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');
}

function stepsTable(run: ScenarioRun): string[] {
  const out: string[] = [];
  let open = false;
  const openTable = () => {
    if (open) return;
    out.push(
      '| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |',
      '|---|---|---|---|---|---|',
    );
    open = true;
  };
  const closeTable = () => {
    if (open) out.push('');
    open = false;
  };
  run.steps.forEach((step, i) => {
    if (step.kind === 'note') {
      closeTable();
      out.push(`> ${step.outcome}`, '');
      return;
    }
    if (step.kind === 'available') {
      closeTable();
      out.push(
        `What ${code(step.actor ?? '')} can do on ${step.claim} now (\`claims show ${step.claim} --as ${step.actor}\`):`,
        '',
        '| Transition | To | Roles | Status for this user |',
        '|---|---|---|---|',
        ...(step.rows ?? []).map(
          (r) => `| ${r.map((c, j) => (j === 0 ? code(c) : cell(c))).join(' | ')} |`,
        ),
        '',
      );
      return;
    }
    openTable();
    const transition =
      step.kind === 'action'
        ? `${code(step.transition ?? '')}${inputSummary(step.input) ? ` · ${inputSummary(step.input)}` : ''}`
        : step.kind === 'system'
          ? 'scheduler pass (`claims system run`)'
          : 'integrity check (`claims verify`)';
    out.push(
      `| ${i + 1} | ${when(step.at)} | ${cell(actorLabel(step))} | ${step.claim ?? ''} | ${cell(transition)} | ${outcome(step)} |`,
    );
  });
  closeTable();
  return out;
}

export function auditTable(entries: AuditEntry[]): string[] {
  const out = [
    '| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |',
    '|---|---|---|---|---|---|',
  ];
  for (const e of entries) {
    const move = `${e.from_state ?? '∅'} → ${e.to_state}${e.from_state === e.to_state ? ' (in-state)' : ''}`;
    const text = [e.reason, e.notes ? `notes: ${e.notes}` : null].filter(Boolean).join('\n');
    out.push(
      `| ${e.claim_seq} | ${e.occurred_at} | ${code(e.transition_id)} | ${move} | ${e.actor_user_id} (${e.actor_role}) | ${cell(text)} |`,
    );
  }
  return out;
}

export function scenariosMarkdown(results: ScenarioResult[], meta: ReportMeta): string {
  const passed = results.filter((r) => r.run.passed).length;
  const out: string[] = [
    '# Scenario results',
    '',
    `Produced by \`npm run scenarios -- --write\`. Each scenario drives the real \`ClaimService\` on PostgreSQL in one process; after every step the outbox worker delivers the queued side effects (lines starting with ↳). The clock is simulated — it starts at ${formatDateTime(meta.clock_start)} and moves one minute per action — so the output is reproducible.`,
    '',
    `- Base workflow: ${code(meta.base.source)} — ${code(meta.base.id)} v${meta.base.version}, config hash ${code(meta.base.hash)}`,
    `- Extension used by scenario 12: ${code(meta.extension.source)} — v${meta.extension.version}, config hash ${code(meta.extension.hash)}`,
    '- Full audit trails: [audit-trails.md](audit-trails.md) and [audit-trails.json](audit-trails.json). Refused attempts: [denied-attempts.md](denied-attempts.md).',
    '',
    '| # | Scenario | In requirement.md | Result | Claims (final state) |',
    '|---|---|---|---|---|',
  ];
  for (const r of results) {
    const claims = r.trails.map((t) => `${t.claim.claim_no} (${t.claim.state})`).join(', ');
    out.push(
      `| ${r.scenario.id} | [${r.scenario.title}](#${r.scenario.id}-${slug(r.scenario.title)}) | ${r.scenario.spec ? `scenario ${r.scenario.spec}` : '—'} | ${r.run.passed ? '✅ PASS' : '❌ FAIL'} | ${claims} |`,
    );
  }
  out.push('', `**${passed}/${results.length} scenarios passed.**`, '');

  for (const r of results) {
    out.push('---', '', `## ${r.scenario.id}. ${r.scenario.title}`, '');
    if (r.scenario.spec) out.push(`*Required scenario ${r.scenario.spec} of requirement.md.*`, '');
    out.push(`**Goal.** ${r.scenario.goal}`, '', ...stepsTable(r.run));
    if (r.run.checks.length) {
      out.push('**Checks**', '');
      for (const c of r.run.checks) {
        out.push(`- ${c.ok ? '✅' : '❌'} ${c.label}${c.ok || !c.detail ? '' : ` — ${c.detail}`}`);
      }
      out.push('');
    }
    for (const t of r.trails) {
      out.push(
        `<details><summary>Audit trail of ${t.claim.claim_no} (${t.entries.length} entries, workflow v${t.workflow_version}, verify ${t.verify.ok ? '✓' : '✗'})</summary>`,
        '',
        ...auditTable(t.entries),
        '',
        '</details>',
        '',
      );
    }
    out.push(`Result: ${r.run.passed ? '✅ **PASS**' : '❌ **FAIL**'}`, '');
  }
  return `${out.join('\n')}\n`;
}

export function auditTrailsMarkdown(trails: ClaimTrail[], meta: ReportMeta): string {
  const out = [
    '# Audit trails',
    '',
    'Every claim created by the scenarios, read back from `audit_log` after the run (`claims audit <claim>`). Entries are append-only and hash-chained per claim; `verify` recomputes the chain, replays `changes` against each `snapshot_hash` and compares the claim row with the last entry.',
    '',
    `Workflow hashes: v${meta.base.version} ${code(meta.base.hash)}, v${meta.extension.version} ${code(meta.extension.hash)}.`,
    '',
  ];
  for (const t of trails) {
    out.push(
      `## ${t.claim.claim_no}`,
      '',
      `Scenario ${t.scenario} · ${t.claim.claim_type} · ${t.claim.claimed_amount.toLocaleString('en-US')} VND · policy ${t.claim.policy_id} · final state **${t.claim.state}** · workflow v${t.workflow_version} · verify: ${t.verify.ok ? `✓ ${t.verify.entries} entries, head ${code(t.verify.head_hash?.slice(0, 16) ?? '')}…` : `✗ ${t.verify.issues.map((i) => i.code).join(', ')}`}`,
      '',
      ...auditTable(t.entries),
      '',
      'Changes recorded per entry (JSON Patch paths):',
      '',
      ...t.entries.map(
        (e) =>
          `${e.claim_seq}. ${code(e.transition_id)}: ${e.changes.map((c) => `${c.op} ${c.path}`).join(', ') || '(none)'}`,
      ),
      '',
    );
  }
  return `${out.join('\n')}\n`;
}

export function deniedMarkdown(
  list: DeniedAttempt[],
  claimNo: (id: string | null) => string,
): string {
  const out = [
    '# Refused attempts',
    '',
    'Refusals are stored in `denied_attempts`, outside the claims and their audit chains, so a refused request never changes a claim. Identical refusals (same claim, user, transition and code) are stored once per minute.',
    '',
    '| Time (UTC) | Claim | User (role) | Transition | Code | Message |',
    '|---|---|---|---|---|---|',
  ];
  for (const d of list) {
    out.push(
      `| ${d.occurred_at} | ${claimNo(d.claim_id)} | ${d.actor_user_id}${d.actor_role ? ` (${d.actor_role})` : ''} | ${code(d.transition_id)} | ${d.error_code} | ${cell(d.message)} |`,
    );
  }
  return `${out.join('\n')}\n`;
}

/** GitHub's heading anchor: lowercase, punctuation dropped, each space a hyphen. */
function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/ /g, '-');
}
