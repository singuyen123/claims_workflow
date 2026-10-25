import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { AppContext } from '../app/bootstrap';
import type { ClaimSnapshot, User } from '../domain/types';
import type { AvailableTransition } from '../engine/engine';
import { WorkflowError } from '../engine/errors';
import type { CompiledTransition } from '../engine/load';
import type { InputDef } from '../engine/schema';
import {
  out,
  renderAudit,
  renderAvailable,
  renderClaim,
  renderError,
  renderResult,
  renderVerify,
} from './render';

type InputField = { name: string } & InputDef & { values?: readonly string[] };

class Cancelled extends Error {}

/** Ctrl+C in any prompt leaves interactive mode. */
function check<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) throw new Cancelled();
  return value as Exclude<T, symbol>;
}

function inputHint(def: InputField): string | undefined {
  if (def.type === 'date') return 'YYYY-MM-DD';
  if (def.type === 'timestamp') return 'ISO-8601, e.g. 2026-10-26T09:00:00Z';
  if (def.type === 'money') return 'whole VND, e.g. 2500000';
  return undefined;
}

/** Prompts for one input based on its declared type; returns undefined when an optional one is skipped. */
async function promptInput(
  def: InputField,
  users: User[],
  policies: string[],
): Promise<string | undefined> {
  const label = `${def.label ?? def.name}${def.required ? '' : pc.dim(' (optional)')}`;
  const skip = { value: '', label: pc.dim('(skip)') };
  const choose = async (options: Array<{ value: string; label?: string; hint?: string }>) => {
    const value = check(
      await p.select({ message: label, options: def.required ? options : [...options, skip] }),
    );
    return value === '' ? undefined : value;
  };
  if (def.type === 'enum') return choose((def.values ?? []).map((v) => ({ value: v })));
  if (def.type === 'user_ref') {
    const eligible = users.filter(
      (u) => !u.service_account && (!def.role || u.roles.includes(def.role)),
    );
    return choose(
      eligible.map((u) => ({ value: u.id, hint: `${u.display_name} · ${u.roles.join(', ')}` })),
    );
  }
  if (def.type === 'policy_ref') return choose(policies.map((id) => ({ value: id })));
  if (def.type === 'boolean') return String(check(await p.confirm({ message: label })));
  const placeholder = inputHint(def);
  const value = check(
    await p.text({
      message: label,
      ...(placeholder ? { placeholder } : {}),
      validate: (v) => {
        const text = (v ?? '').trim();
        if (!text) return def.required ? 'Required' : undefined;
        if ((def.type === 'money' || def.type === 'integer') && !/^\d+$/.test(text))
          return 'Enter a whole number';
        if (def.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) return 'Use YYYY-MM-DD';
        if (def.max_length !== undefined && text.length > def.max_length)
          return `At most ${def.max_length} characters`;
        return undefined;
      },
    }),
  );
  return value.trim() === '' ? undefined : value.trim();
}

async function promptInputs(
  fields: InputField[],
  app: AppContext,
): Promise<Record<string, string>> {
  const users = await app.service.users();
  const policies = (await app.ops.policies()).map((pol) => pol.id);
  const input: Record<string, string> = {};
  for (const field of fields) {
    const value = await promptInput(field, users, policies);
    if (value !== undefined) input[field.name] = value;
  }
  return input;
}

function creationFields(t: CompiledTransition, app: AppContext): InputField[] {
  return Object.entries(t.inputs).map(([name, def]) => ({
    name,
    ...def,
    ...(def.type === 'enum' ? { values: app.workflow.enums[def.enum ?? ''] ?? [] } : {}),
  }));
}

/** Runs an action and prints the outcome; refusals are shown, not thrown. */
async function attempt(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    if (error instanceof Cancelled) return;
    if (!(error instanceof WorkflowError)) throw error;
    renderError(error);
  }
}

function transitionOption(t: AvailableTransition & { acting_role: string }) {
  const failing = t.checks.filter((c) => !c.ok);
  const target = t.to ? `→ ${t.to}` : '(same state)';
  return {
    value: t.id,
    label: `${t.allowed ? pc.bold(t.id) : pc.dim(t.id)} ${pc.dim(target)}`,
    hint: t.allowed ? `as ${t.acting_role}` : (failing[0]?.message ?? 'not allowed'),
  };
}

async function claimMenu(app: AppContext, user: User, claimId: string) {
  for (;;) {
    const { claim, roles, transitions } = await app.service.available(claimId, user.id);
    const wf = await app.service.workflowFor(app.pool, claim);
    out();
    renderClaim(claim, wf, await app.ops.policy(claim.policy_id));
    renderAvailable(user.id, roles, transitions);
    const manual = transitions.filter((t) => !t.automatic);
    const choice = check(
      await p.select({
        message: 'What next?',
        options: [
          ...manual.map(transitionOption),
          { value: ':audit', label: 'Show audit trail' },
          { value: ':verify', label: 'Verify integrity' },
          { value: ':back', label: 'Back' },
        ],
      }),
    );
    if (choice === ':back') return;
    if (choice === ':audit') {
      renderAudit((await app.service.audit(claim.id)).entries);
      continue;
    }
    if (choice === ':verify') {
      renderVerify(await app.service.verify(claim.id));
      continue;
    }
    const t = manual.find((x) => x.id === choice);
    if (!t) continue;
    await attempt(async () => {
      const input = await promptInputs(t.inputs, app);
      if (
        !check(
          await p.confirm({
            message: `Run ${t.id} on ${claim.claim_no} as ${user.id} (${t.acting_role})?`,
          }),
        )
      ) {
        return;
      }
      const result = await app.service.act({
        claim: claim.id,
        transition_id: t.id,
        user_id: user.id,
        role: t.acting_role,
        input,
        expected_version: claim.version,
      });
      renderResult(result);
    });
  }
}

async function submitClaim(app: AppContext, user: User) {
  const t = app.workflow.creation;
  const role = t.roles.find((r) => user.roles.includes(r));
  if (!role) return;
  await attempt(async () => {
    const input = await promptInputs(creationFields(t, app), app);
    const result = await app.service.act({
      claim: null,
      transition_id: t.id,
      user_id: user.id,
      role,
      input,
    });
    renderResult(result);
    await claimMenu(app, user, result.claim.id);
  });
}

async function pickClaim(app: AppContext, user: User): Promise<string | undefined> {
  const claims: ClaimSnapshot[] = await app.service.listClaims({ limit: 30 });
  if (claims.length === 0) {
    p.log.info('No claims yet.');
    return undefined;
  }
  const own = (c: ClaimSnapshot) => user.member_id !== null && c.member_id === user.member_id;
  const id = check(
    await p.select({
      message: 'Claim',
      options: [
        ...claims.map((c) => ({
          value: c.id,
          label: `${c.claim_no}  ${pc.cyan(c.state)}`,
          hint: `${c.claim_type} · v${c.version}${own(c) ? ' · yours' : ''}`,
        })),
        { value: '', label: 'Back' },
      ],
    }),
  );
  return id || undefined;
}

export async function runInteractive(app: AppContext): Promise<void> {
  p.intro(pc.bold(`Claims workflow · ${app.workflow.id} v${app.workflow.version}`));
  p.log.info('Side effects are queued; run `npm run worker` in another terminal to deliver them.');
  try {
    for (;;) {
      const users = (await app.service.users()).filter((u) => !u.service_account);
      const userId = check(
        await p.select({
          message: 'Act as',
          options: [
            ...users.map((u) => ({
              value: u.id,
              hint: `${u.display_name} · ${u.roles.join(', ')}`,
            })),
            { value: '', label: 'Quit' },
          ],
        }),
      );
      const user = users.find((u) => u.id === userId);
      if (!user) break;
      for (;;) {
        const canSubmit = app.workflow.creation.roles.some((r) => user.roles.includes(r));
        const action = check(
          await p.select({
            message: `${user.id}: what would you like to do?`,
            options: [
              { value: 'open', label: 'Open a claim' },
              ...(canSubmit
                ? [{ value: 'new', label: `New claim (${app.workflow.creation.id})` }]
                : []),
              { value: 'switch', label: 'Switch user' },
            ],
          }),
        );
        if (action === 'switch') break;
        if (action === 'new') await submitClaim(app, user);
        if (action === 'open') {
          const claimId = await pickClaim(app, user);
          if (claimId) await claimMenu(app, user, claimId);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
  }
  p.outro('Bye');
}
