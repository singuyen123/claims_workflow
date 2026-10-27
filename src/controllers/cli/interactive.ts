import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ClaimSnapshot, User } from '../../domain/types';
import type { AvailableTransition } from '../../engine/engine';
import { WorkflowError } from '../../engine/errors';
import type { Services } from '../../services/index';
import type { InputChoice } from '../../services/operations-service';
import type { InputField } from '../../services/workflow-service';
import {
  out,
  renderAudit,
  renderAvailable,
  renderClaim,
  renderError,
  renderResult,
  renderVerify,
} from './render';

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
  choices: InputChoice[] | undefined,
): Promise<string | undefined> {
  const label = `${def.label ?? def.name}${def.required ? '' : pc.dim(' (optional)')}`;
  const skip = { value: '', label: pc.dim('(skip)') };
  if (choices) {
    const options = choices.map(({ value, user }) => ({
      value,
      ...(user ? { hint: `${user.display_name} · ${user.roles.join(', ')}` } : {}),
    }));
    const value = check(
      await p.select({ message: label, options: def.required ? options : [...options, skip] }),
    );
    return value === '' ? undefined : value;
  }
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
  services: Services,
): Promise<Record<string, string>> {
  const choices = await services.operations.inputChoices(fields);
  const input: Record<string, string> = {};
  for (const field of fields) {
    const value = await promptInput(field, choices[field.name]);
    if (value !== undefined) input[field.name] = value;
  }
  return input;
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

async function claimMenu(services: Services, user: User, claimId: string) {
  for (;;) {
    const { claim, workflow, policy, available } = await services.queries.inspect(claimId, user.id);
    if (!available) return;
    out();
    renderClaim(claim, workflow, policy);
    renderAvailable(user.id, available.roles, available.transitions);
    const manual = available.transitions.filter((t) => !t.automatic);
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
      renderAudit(await services.queries.auditEntries(claim.id));
      continue;
    }
    if (choice === ':verify') {
      renderVerify(await services.queries.verify(claim.id));
      continue;
    }
    const t = manual.find((x) => x.id === choice);
    if (!t) continue;
    await attempt(async () => {
      const input = await promptInputs(t.inputs, services);
      if (
        !check(
          await p.confirm({
            message: `Run ${t.id} on ${claim.claim_no} as ${user.id} (${t.acting_role})?`,
          }),
        )
      ) {
        return;
      }
      const result = await services.claims.act({
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

async function submitClaim(services: Services, user: User) {
  const form = services.workflows.creationForm(user);
  const role = form.acting_role;
  if (!role) return;
  await attempt(async () => {
    const input = await promptInputs(form.inputs, services);
    const result = await services.claims.create({ user_id: user.id, role, input });
    renderResult(result);
    await claimMenu(services, user, result.claim.id);
  });
}

async function pickClaim(services: Services, user: User): Promise<string | undefined> {
  const claims: ClaimSnapshot[] = await services.queries.listClaims({ limit: 30 });
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

export async function runInteractive(services: Services): Promise<void> {
  const wf = services.workflows.current;
  p.intro(pc.bold(`Claims workflow · ${wf.id} v${wf.version}`));
  p.log.info('Side effects are queued; run `npm run worker` in another terminal to deliver them.');
  try {
    for (;;) {
      const users = await services.operations.people();
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
        const form = services.workflows.creationForm(user);
        const action = check(
          await p.select({
            message: `${user.id}: what would you like to do?`,
            options: [
              { value: 'open', label: 'Open a claim' },
              ...(form.acting_role ? [{ value: 'new', label: `New claim (${form.id})` }] : []),
              { value: 'switch', label: 'Switch user' },
            ],
          }),
        );
        if (action === 'switch') break;
        if (action === 'new') await submitClaim(services, user);
        if (action === 'open') {
          const claimId = await pickClaim(services, user);
          if (claimId) await claimMenu(services, user, claimId);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
  }
  p.outro('Bye');
}
