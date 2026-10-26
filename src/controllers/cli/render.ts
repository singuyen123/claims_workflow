import Table from 'cli-table3';
import pc from 'picocolors';
import type {
  AuditEntry,
  ClaimSnapshot,
  DefinitionSummary,
  DeniedAttempt,
  MockNotification,
  MockPayment,
  OutboxMessage,
  Policy,
  User,
} from '../../domain/types';
import type { AvailableTransition } from '../../engine/engine';
import { WorkflowError } from '../../engine/errors';
import { type CompiledWorkflow, ConfigError } from '../../engine/load';
import { formatDateTime, formatMoney } from '../../engine/templates';
import type { ClaimListItem } from '../../services/claim-query-service';
import type { ActResult } from '../../services/claim-service';
import { describeRecipient } from '../../services/effect-handlers';
import type { VerifyReport } from '../../services/verify';

export const out = (line = '') => process.stdout.write(`${line}\n`);

export function printJson(value: unknown) {
  out(JSON.stringify(value, null, 2));
}

const table = (head: string[]) =>
  new Table({ head: head.map((h) => pc.bold(h)), style: { head: [], border: [] }, wordWrap: true });

export const when = (iso: string | null | undefined) => (iso ? formatDateTime(iso) : '—');

function stateLabel(state: string, wf?: CompiledWorkflow): string {
  if (wf?.isTerminal(state)) return pc.gray(state);
  return pc.cyan(state);
}

export function renderClaim(claim: ClaimSnapshot, wf: CompiledWorkflow, policy?: Policy | null) {
  const d = claim.data as Record<string, unknown>;
  const limit = policy ? ` (limit ${formatMoney(policy.coverage_limit)})` : '';
  out(
    `${pc.bold(claim.claim_no)}  ${claim.claim_type}  ${formatMoney(claim.claimed_amount)}  policy ${claim.policy_id}${limit}`,
  );
  out(
    `State ${stateLabel(claim.state, wf)} since ${when(claim.state_entered_at)} · version ${claim.version} · ` +
      `workflow ${wf.id} v${wf.version} (${claim.config_hash.slice(0, 12)})`,
  );
  const extras: string[] = [];
  if (d.assessor_id) extras.push(`assessor ${d.assessor_id}`);
  const assessment = d.assessment as Record<string, unknown> | undefined;
  if (assessment?.approved_amount !== undefined) {
    extras.push(`assessed ${formatMoney(Number(assessment.approved_amount))}`);
  }
  const cosign = d.cosign as Record<string, unknown> | undefined;
  if (cosign) extras.push(`co-signed by ${cosign.user_id}`);
  for (const [name, value] of Object.entries(claim.counters)) {
    const max = wf.definition.counters[name]?.max;
    extras.push(`${name} ${value}${max ? `/${max}` : ''}`);
  }
  if (extras.length) out(pc.dim(extras.join(' · ')));

  const required = wf.definition.document_requirements[claim.claim_type] ?? [];
  if (required.length) {
    const docs = Array.isArray(d.documents) ? (d.documents as Array<{ type?: string }>) : [];
    const have = new Set(docs.map((doc) => doc.type));
    const extra = [...have].filter((t) => t && !required.includes(t));
    const parts = required.map((doc) =>
      have.has(doc) ? pc.green(`✓ ${doc}`) : pc.red(`✗ ${doc}`),
    );
    out(`Documents: ${parts.join('  ')}${extra.length ? pc.dim(`  + ${extra.join(', ')}`) : ''}`);
  }
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export function renderConfigSummary(wf: CompiledWorkflow, source: string) {
  const d = wf.definition;
  const states = Object.values(d.states);
  const kinds = { create: 0, move: 0, stay: 0 };
  for (const t of wf.transitions.values()) kinds[t.kind]++;
  out(`${pc.green('✓')} ${source} is valid`);
  out(`  workflow ${pc.bold(wf.id)} v${wf.version} · config hash ${wf.hash}`);
  out(
    `  ${count(states.length, 'state')} (${states.filter((s) => s.terminal).length} terminal) · ` +
      `${count(wf.transitions.size, 'transition')} (${kinds.create} creation, ${kinds.move} state changes, ${kinds.stay} in-state actions) · ` +
      `${count(Object.keys(d.counters).length, 'counter')} · ${count(Object.keys(d.rules).length, 'rule')} · ` +
      `${count(Object.keys(d.templates).length, 'template')}`,
  );
  for (const w of wf.warnings) out(pc.yellow(`  ! ${w.path}: ${w.message}`));
}

/** Transitions defined for the claim's state, without evaluating them for a user. */
export function renderStateTransitions(claim: ClaimSnapshot, wf: CompiledWorkflow) {
  const list = wf.outgoing.get(claim.state) ?? [];
  if (wf.isTerminal(claim.state) || list.length === 0) {
    out(pc.gray('No transitions: the claim is in a terminal state.'));
    return;
  }
  const t = table(['Transition', 'To', 'Roles', 'Inputs']);
  for (const tr of list) {
    const inputs = Object.entries(tr.inputs).map(([name, def]) =>
      def.required ? name : pc.dim(`${name}?`),
    );
    t.push([tr.id, tr.to ?? pc.dim('(same state)'), tr.roles.join(', '), inputs.join(', ')]);
  }
  out(t.toString());
  out(pc.dim('Add --as <user> to see which of these that user can run now and why.'));
}

/** `queue`: work-queue view, with what the viewing user can do next (`can_run`). */
export function renderClaimList(claims: ClaimListItem[], queue = false) {
  if (claims.length === 0) {
    out(pc.dim('No claims found.'));
    return;
  }
  const head = ['Claim', 'State', 'Type', 'Amount', 'Member', 'Assessor', 'Updated (ICT)'];
  if (queue) head.push('You can');
  const t = table(head);
  for (const c of claims) {
    const row = [
      c.claim_no,
      pc.cyan(c.state),
      c.claim_type,
      formatMoney(c.claimed_amount),
      c.member_id,
      String(c.data.assessor_id ?? '—'),
      when(c.updated_at),
    ];
    if (queue) row.push(c.can_run?.join(', ') ?? '');
    t.push(row);
  }
  out(t.toString());
}

export function renderUsers(users: User[]) {
  const t = table(['User', 'Name', 'Roles', 'Member']);
  for (const u of users) {
    const roles = `${u.roles.join(', ')}${u.service_account ? pc.dim(' (service account)') : ''}`;
    t.push([u.id, u.display_name, roles, u.member_id ?? '—']);
  }
  out(t.toString());
}

export function renderPolicies(policies: Policy[]) {
  const t = table(['Policy', 'Member', 'Product', 'Coverage limit', 'Cover period']);
  for (const p of policies) {
    t.push([
      p.id,
      p.member_id,
      p.product,
      formatMoney(p.coverage_limit),
      `${p.effective_from} → ${p.effective_to}`,
    ]);
  }
  out(t.toString());
}

export function renderDefinitions(defs: Array<DefinitionSummary & { current: boolean }>) {
  const t = table(['Workflow', 'Version', 'Config hash', 'Registered (ICT)', '']);
  for (const d of defs) {
    const current = d.current ? pc.green('current') : '';
    t.push([d.workflow_id, String(d.version), d.config_hash, when(d.registered_at), current]);
  }
  out(t.toString());
}

export function renderPayments(list: MockPayment[]) {
  if (list.length === 0) {
    out(pc.dim('No payments sent to the mock gateway.'));
    return;
  }
  const t = table(['Gateway ref', 'Amount', 'Reference', 'Idempotency key', 'At (ICT)']);
  for (const p of list) {
    t.push([
      p.gateway_ref,
      formatMoney(p.amount),
      p.reference,
      p.idempotency_key,
      when(p.created_at),
    ]);
  }
  out(t.toString());
}

/** Bodies are shown only with `full`: they can contain medical details. */
export function renderNotifications(list: MockNotification[], full = false) {
  if (list.length === 0) {
    out(pc.dim('No notifications sent.'));
    return;
  }
  const t = table(['Sent (ICT)', 'Template', 'To', 'Channel', full ? 'Subject / body' : 'Subject']);
  for (const n of list) {
    const text = full ? `${n.subject ?? ''}\n${pc.dim(n.body)}` : (n.subject ?? '');
    t.push([when(n.sent_at), n.template, describeRecipient(n.recipient), n.channel, text]);
  }
  out(t.toString());
}

export function renderAvailable(
  userId: string,
  roles: string[],
  transitions: Array<AvailableTransition & { acting_role: string }>,
) {
  out(`Acting as ${pc.bold(userId)} (${roles.join(', ')})`);
  if (transitions.length === 0) {
    out(pc.gray('No transitions: the claim is in a terminal state.'));
    return;
  }
  const t = table(['Transition', 'To', 'Roles', 'Status']);
  for (const tr of transitions) {
    const failing = tr.checks.filter((c) => !c.ok);
    const needs = tr.inputs.filter((i) => i.required).map((i) => i.name);
    const notes: string[] = [];
    if (tr.automatic) notes.push(pc.dim('automatic (system)'));
    if (failing.length) {
      for (const f of failing) notes.push(pc.red(`✗ ${f.code}: ${f.message}`));
    } else {
      notes.push(pc.green('✓ ready'));
    }
    if (needs.length) notes.push(pc.yellow(`needs input: ${needs.join(', ')}`));
    for (const c of tr.checks) {
      if (c.ok && c.stage === 'counter') notes.push(pc.dim(c.message));
    }
    t.push([
      tr.allowed ? pc.bold(tr.id) : tr.id,
      tr.to ?? pc.dim('(same state)'),
      tr.roles.join(', '),
      notes.join('\n'),
    ]);
  }
  out(t.toString());
}

export function renderResult(result: ActResult) {
  const e = result.entry;
  const arrow =
    e.from_state === null
      ? `new → ${e.to_state}`
      : e.from_state === e.to_state
        ? `${e.to_state} (no state change)`
        : `${e.from_state} → ${e.to_state}`;
  const prefix = result.replayed ? pc.yellow('↺ replayed (idempotency key):') : pc.green('✓');
  out(
    `${prefix} ${pc.bold(e.transition_id)} on ${pc.bold(result.claim.claim_no)}: ${arrow} · v${e.claim_version}`,
  );
  const queued = e.effects.filter((x) => x.idempotency_key);
  if (queued.length) {
    out(
      pc.dim(
        `  queued ${queued.length} side effect(s): ${queued.map((x) => x.template ?? x.type).join(', ')} → delivered by the worker`,
      ),
    );
  }
  for (const auto of result.automatic) {
    out(
      `${pc.magenta('⚙ system')} ${pc.bold(auto.entry.transition_id)}: ${auto.entry.from_state} → ${auto.entry.to_state} · v${auto.entry.claim_version}`,
    );
  }
}

export function renderAudit(entries: AuditEntry[], options: { stateChangesOnly?: boolean } = {}) {
  const t = table(['#', 'When (ICT)', 'Transition', 'From → To', 'Triggered by', 'Reason / notes']);
  for (const e of entries) {
    const changed = e.from_state !== e.to_state;
    if (options.stateChangesOnly && !changed) continue;
    const move =
      e.from_state === null
        ? `∅ → ${e.to_state}`
        : changed
          ? `${e.from_state} → ${e.to_state}`
          : pc.dim(`${e.to_state} (stay)`);
    const text = [e.reason, e.notes].filter(Boolean).join('\n');
    t.push([
      String(e.claim_seq),
      when(e.occurred_at),
      e.transition_id,
      move,
      `${e.actor_user_id}\n${pc.dim(e.actor_role)}`,
      text,
    ]);
  }
  out(t.toString());
}

export function renderDenied(list: DeniedAttempt[]) {
  if (list.length === 0) {
    out(pc.dim('No refused attempts recorded.'));
    return;
  }
  const t = table(['When (ICT)', 'Transition', 'By', 'Code', 'Message']);
  for (const d of list) {
    t.push([
      when(d.occurred_at),
      d.transition_id,
      `${d.actor_user_id}${d.actor_role ? `\n${pc.dim(d.actor_role)}` : ''}`,
      pc.red(d.error_code),
      d.message,
    ]);
  }
  out(t.toString());
}

export function renderOutbox(list: OutboxMessage[]) {
  const t = table(['#', 'Type', 'Status', 'Attempts', 'Key', 'Detail']);
  for (const m of list) {
    const color = m.status === 'DONE' ? pc.green : m.status === 'DEAD' ? pc.red : pc.yellow;
    const detail =
      m.last_error ??
      (m.result ? JSON.stringify(m.result) : String(m.payload.template ?? m.payload.message ?? ''));
    t.push([
      String(m.id),
      m.effect_type,
      color(m.status),
      `${m.attempts}/${m.max_attempts}`,
      m.idempotency_key,
      detail,
    ]);
  }
  out(t.toString());
}

export function renderVerify(report: VerifyReport) {
  if (report.ok) {
    out(
      `${pc.green('✓')} ${pc.bold(report.claim_no)}: ${report.entries} audit entries — chain intact, replay matches, claim row matches entry #${report.entries}`,
    );
    return;
  }
  out(`${pc.red('✗')} ${pc.bold(report.claim_no)}: integrity check failed`);
  for (const issue of report.issues) {
    out(
      `  ${pc.red(issue.code)}${issue.claim_seq ? ` (#${issue.claim_seq})` : ''}: ${issue.message}`,
    );
    for (const op of issue.diff ?? []) {
      out(
        pc.dim(`      ${op.op} ${op.path}${'value' in op ? ` = ${JSON.stringify(op.value)}` : ''}`),
      );
    }
  }
}

export function renderError(error: unknown) {
  if (error instanceof WorkflowError) {
    out(`${pc.red(pc.bold(error.code))}: ${error.message}`);
    const d = error.details;
    const failures = d.failures ?? [];
    if (failures.length > 1 || (failures.length === 1 && failures[0]?.message !== error.message)) {
      for (const f of failures) out(`  ${pc.red('•')} ${pc.bold(f.code)}: ${f.message}`);
    }
    for (const i of d.input_errors ?? []) out(`  ${pc.red('•')} ${i.input}: ${i.message}`);
    if (d.counter) out(pc.dim(`  counter ${d.counter.name}: ${d.counter.value}/${d.counter.max}`));
    return;
  }
  if (error instanceof ConfigError) {
    out(pc.red(pc.bold(`Invalid workflow config ${error.source}`)));
    for (const issue of error.issues)
      out(`  ${pc.red('•')} ${pc.bold(issue.path)}: ${issue.message}`);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  out(`${pc.red(pc.bold('Error'))}: ${message}`);
}
