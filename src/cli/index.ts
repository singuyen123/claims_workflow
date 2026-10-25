import { Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';
import {
  type AppContext,
  createApp,
  migrateSchema,
  resetSchema,
  seedSchema,
} from '../app/bootstrap';
import type { ActRequest } from '../app/claim-service';
import { type Clock, ManualClock } from '../app/clock';
import type { OutboxStatus } from '../domain/types';
import { WorkflowError } from '../engine/errors';
import { ConfigError, loadWorkflowFile } from '../engine/load';
import { toMermaid } from '../engine/mermaid';
import { env } from '../infra/env';
import { runInteractive } from './interactive';
import {
  out,
  printJson,
  renderAudit,
  renderAvailable,
  renderClaim,
  renderClaimList,
  renderConfigSummary,
  renderDefinitions,
  renderDenied,
  renderError,
  renderNotifications,
  renderOutbox,
  renderPayments,
  renderPolicies,
  renderResult,
  renderStateTransitions,
  renderUsers,
  renderVerify,
} from './render';

interface GlobalOptions {
  config?: string;
  schema?: string;
  json?: boolean;
}

/** Wrong use of a command (exit code 2), as opposed to a refusal by the workflow (exit code 1). */
class UsageError extends Error {}

const collect = (value: string, previous: string[]) => [...previous, value];

function wholeNumber(value: string): number {
  if (!/^\d+$/.test(value)) throw new InvalidArgumentError('must be a whole number');
  return Number(value);
}

function parseInputs(pairs: string[]): Record<string, string> {
  const input: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new UsageError(`--input expects key=value, got '${pair}'`);
    input[pair.slice(0, eq).trim()] = pair.slice(eq + 1);
  }
  return input;
}

async function withApp(
  cmd: Command,
  fn: (app: AppContext, g: GlobalOptions) => Promise<void>,
  clock?: Clock,
) {
  const g = cmd.optsWithGlobals<GlobalOptions>();
  const app = await createApp({
    ...(g.config ? { configPath: g.config } : {}),
    ...(g.schema ? { schema: g.schema } : {}),
    ...(clock ? { clock } : {}),
  });
  try {
    await fn(app, g);
  } finally {
    await app.close();
  }
}

const program = new Command('claims')
  .description('Config-driven claims workflow orchestrator')
  .option('-c, --config <file>', 'workflow file used for new claims (default: $WORKFLOW_CONFIG)')
  .option('--schema <name>', 'database schema (default: $DB_SCHEMA or "claims")')
  .option('--json', 'machine-readable JSON output')
  .showHelpAfterError('(run with --help for usage)')
  .showSuggestionAfterError();

// ── claims and transitions ───────────────────────────────────────────────────────────────────

interface ActOptions {
  as: string;
  role?: string;
  input: string[];
  reason?: string;
  notes?: string;
  expectedVersion?: number;
  idempotencyKey?: string;
}

function actRequest(
  claim: string | null,
  transition: string,
  o: ActOptions,
  extra = {},
): ActRequest {
  const input: Record<string, unknown> = { ...extra, ...parseInputs(o.input) };
  if (o.reason !== undefined) input.reason = o.reason;
  if (o.notes !== undefined) input.notes = o.notes;
  return {
    claim,
    transition_id: transition,
    user_id: o.as,
    input,
    ...(o.role ? { role: o.role } : {}),
    ...(o.expectedVersion !== undefined ? { expected_version: o.expectedVersion } : {}),
    ...(o.idempotencyKey ? { idempotency_key: o.idempotencyKey } : {}),
  };
}

const actorOptions = (cmd: Command) =>
  cmd
    .requiredOption('--as <user>', 'acting user id (see `claims users`)')
    .option('--role <role>', 'role to act in, for users holding several roles');

actorOptions(
  program
    .command('run')
    .description('Run a transition by id. Use "-" as the claim for the creation transition.')
    .argument('<claim>', 'claim number (CLM-…), claim id, or "-"')
    .argument('<transition>', 'transition id, e.g. verify_documents'),
)
  .option('-i, --input <key=value>', 'transition input (repeatable)', collect, [])
  .option('--reason <text>', 'shortcut for --input reason=<text>')
  .option('--notes <text>', 'free-text notes recorded in the audit trail')
  .option(
    '--expected-version <n>',
    'refuse if the claim has changed (optimistic check)',
    wholeNumber,
  )
  .option(
    '--idempotency-key <key>',
    'repeating a request with the same key returns the first result',
  )
  .action(async (claim: string, transition: string, o: ActOptions, cmd: Command) => {
    await withApp(cmd, async ({ service }, g) => {
      const result = await service.act(actRequest(claim === '-' ? null : claim, transition, o));
      if (g.json) printJson(result);
      else renderResult(result);
    });
  });

actorOptions(
  program.command('create').description('Submit a new claim (runs the creation transition)'),
)
  .requiredOption('--policy <id>', 'policy id, e.g. POL-001')
  .requiredOption('--type <claim_type>', 'claim type, e.g. outpatient')
  .requiredOption('--amount <vnd>', 'claimed amount in VND')
  .option(
    '-i, --input <key=value>',
    'other inputs of the creation transition (repeatable)',
    collect,
    [],
  )
  .option('--notes <text>', 'free-text notes recorded in the audit trail')
  .option(
    '--idempotency-key <key>',
    'repeating a request with the same key returns the first result',
  )
  .action(
    async (o: ActOptions & { policy: string; type: string; amount: string }, cmd: Command) => {
      await withApp(cmd, async ({ service }, g) => {
        const request = actRequest(null, service.workflow.creation.id, o, {
          policy_id: o.policy,
          claim_type: o.type,
          claimed_amount: o.amount,
        });
        const result = await service.act(request);
        if (g.json) printJson(result);
        else renderResult(result);
      });
    },
  );

program
  .command('show')
  .description('Show a claim and, with --as, what that user can do next and why')
  .argument('<claim>', 'claim number or id')
  .option('--as <user>', 'evaluate the available transitions for this user')
  .option('--role <role>', 'only this role of the user')
  .action(async (ref: string, o: { as?: string; role?: string }, cmd: Command) => {
    await withApp(cmd, async ({ service, ops }, g) => {
      const claim = await service.requireClaim(ref);
      const wf = await service.workflowFor(service.pool, claim);
      const available = o.as ? await service.available(claim.id, o.as, o.role) : undefined;
      if (g.json) {
        printJson({
          claim,
          workflow: { id: wf.id, version: wf.version, config_hash: wf.hash },
          available,
        });
        return;
      }
      renderClaim(claim, wf, await ops.policy(claim.policy_id));
      out();
      if (available) renderAvailable(o.as as string, available.roles, available.transitions);
      else renderStateTransitions(claim, wf);
    });
  });

program
  .command('list')
  .description('List claims; --queue --as <user> shows only claims that user can act on now')
  .option('--state <state...>', 'only these states')
  .option('--assessor <user>', 'only claims assigned to this assessor')
  .option('--member <member_id>', "only this member's claims")
  .option('--queue', 'work queue of the --as user')
  .option('--as <user>', 'user for --queue')
  .option('--limit <n>', 'maximum number of claims', wholeNumber, 50)
  .action(
    async (
      o: {
        state?: string[];
        assessor?: string;
        member?: string;
        queue?: boolean;
        as?: string;
        limit: number;
      },
      cmd: Command,
    ) => {
      if (o.queue && !o.as) throw new UsageError('--queue needs --as <user>');
      await withApp(cmd, async ({ service }, g) => {
        let claims = await service.listClaims({
          limit: o.limit,
          ...(o.state ? { states: o.state } : {}),
          ...(o.assessor ? { assessorId: o.assessor } : {}),
          ...(o.member ? { memberId: o.member } : {}),
        });
        let next: Map<string, string> | undefined;
        if (o.queue && o.as) {
          next = new Map();
          for (const claim of claims) {
            const { transitions } = await service.available(claim.id, o.as);
            const ready = transitions.filter((t) => t.allowed && !t.automatic).map((t) => t.id);
            if (ready.length) next.set(claim.id, ready.join(', '));
          }
          claims = claims.filter((c) => next?.has(c.id));
        }
        if (g.json)
          printJson(
            next ? claims.map((c) => ({ ...c, can_run: next?.get(c.id)?.split(', ') })) : claims,
          );
        else renderClaimList(claims, next);
      });
    },
  );

program
  .command('audit')
  .description('Audit trail of a claim (every transition, who, when, why, and what changed)')
  .argument('<claim>', 'claim number or id')
  .option('--state-changes-only', 'hide in-state actions')
  .action(async (ref: string, o: { stateChangesOnly?: boolean }, cmd: Command) => {
    await withApp(cmd, async ({ service }, g) => {
      const { entries } = await service.audit(ref);
      const shown = o.stateChangesOnly
        ? entries.filter((e) => e.from_state !== e.to_state)
        : entries;
      if (g.json) printJson(shown);
      else renderAudit(shown);
    });
  });

program
  .command('denied')
  .description('Refused attempts (kept apart from the audit chain, one row per minute per kind)')
  .argument('[claim]', 'claim number or id (default: all claims)')
  .action(async (ref: string | undefined, _o: unknown, cmd: Command) => {
    await withApp(cmd, async ({ service }, g) => {
      const list = await service.denied(ref);
      if (g.json) printJson(list);
      else renderDenied(list);
    });
  });

program
  .command('verify')
  .description('Check the audit hash chain, replay every change and compare with the claim row')
  .argument('[claim]', 'claim number or id')
  .option('--all', 'verify every claim')
  .action(async (ref: string | undefined, o: { all?: boolean }, cmd: Command) => {
    if (!ref && !o.all) throw new UsageError('give a claim or --all');
    await withApp(cmd, async ({ service }, g) => {
      const reports = ref ? [await service.verify(ref)] : await service.verifyAll();
      if (g.json) printJson(ref ? reports[0] : reports);
      else if (reports.length === 0) out(pc.dim('No claims to verify.'));
      else for (const r of reports) renderVerify(r);
      if (reports.some((r) => !r.ok)) process.exitCode = 1;
    });
  });

program
  .command('users')
  .description('Users and the roles they hold')
  .action(async (_o: unknown, cmd: Command) => {
    await withApp(cmd, async ({ service }, g) => {
      const users = await service.users();
      if (g.json) printJson(users);
      else renderUsers(users);
    });
  });

program
  .command('policies')
  .description('Policies and their coverage limits')
  .action(async (_o: unknown, cmd: Command) => {
    await withApp(cmd, async ({ ops }, g) => {
      const policies = await ops.policies();
      if (g.json) printJson(policies);
      else renderPolicies(policies);
    });
  });

// ── workflow configuration ───────────────────────────────────────────────────────────────────

const config = program.command('config').description('Workflow configuration');

config
  .command('validate')
  .description(
    'Validate a workflow file: schema, references, paths and types, cycles (no database)',
  )
  .argument('[file]', 'workflow file (default: --config or $WORKFLOW_CONFIG)')
  .action(async (file: string | undefined, _o: unknown, cmd: Command) => {
    const g = cmd.optsWithGlobals<GlobalOptions>();
    const source = file ?? g.config ?? env.workflowConfig();
    const wf = loadWorkflowFile(source);
    if (g.json) {
      printJson({
        ok: true,
        source,
        workflow: wf.id,
        version: wf.version,
        config_hash: wf.hash,
        warnings: wf.warnings,
      });
    } else {
      renderConfigSummary(wf, source);
    }
  });

config
  .command('diagram')
  .description('Mermaid state diagram; with --claim, highlights where that claim is and has been')
  .argument('[file]', 'workflow file (default: --config or $WORKFLOW_CONFIG)')
  .option('--claim <claim>', "use the claim's pinned definition and highlight its path")
  .option('--no-roles', 'leave roles off the edges')
  .action(async (file: string | undefined, o: { claim?: string; roles: boolean }, cmd: Command) => {
    const g = cmd.optsWithGlobals<GlobalOptions>();
    if (!o.claim) {
      out(
        toMermaid(loadWorkflowFile(file ?? g.config ?? env.workflowConfig()), { roles: o.roles }),
      );
      return;
    }
    await withApp(cmd, async ({ service }) => {
      const { claim, entries } = await service.audit(o.claim as string);
      const wf = await service.workflowFor(service.pool, claim);
      out(
        toMermaid(wf, {
          current: claim.state,
          visited: entries.map((e) => e.to_state),
          roles: o.roles,
        }),
      );
    });
  });

config
  .command('list')
  .description('Workflow definitions registered in the database (claims are pinned to one of them)')
  .action(async (_o: unknown, cmd: Command) => {
    await withApp(cmd, async ({ ops, workflow }, g) => {
      const defs = await ops.definitions();
      if (g.json) printJson(defs.map((d) => ({ ...d, current: d.config_hash === workflow.hash })));
      else renderDefinitions(defs, workflow.hash);
    });
  });

// ── database ─────────────────────────────────────────────────────────────────────────────────

const db = program.command('db').description('Database maintenance (runs as the owner role)');

db.command('migrate')
  .description('Apply pending migrations')
  .action(async (_o: unknown, cmd: Command) => {
    const g = cmd.optsWithGlobals<GlobalOptions>();
    const schema = g.schema ?? env.schema();
    const result = await migrateSchema(env.ownerUrl(), schema);
    if (g.json) printJson(result);
    else
      out(
        `${pc.green('✓')} schema ${schema}: ${result.applied.length ? `applied ${result.applied.join(', ')}` : 'up to date'}`,
      );
  });

db.command('seed')
  .description('Load users and policies from config/seed.yaml (upsert)')
  .option('--file <path>', 'seed file', 'config/seed.yaml')
  .action(async (o: { file: string }, cmd: Command) => {
    const g = cmd.optsWithGlobals<GlobalOptions>();
    const schema = g.schema ?? env.schema();
    const result = await seedSchema(env.ownerUrl(), schema, o.file);
    if (g.json) printJson(result);
    else
      out(`${pc.green('✓')} schema ${schema}: ${result.users} users, ${result.policies} policies`);
  });

db.command('reset')
  .description('DROP the schema and recreate it (development only: audit data is deleted)')
  .option('--yes', 'confirm')
  .action(async (o: { yes?: boolean }, cmd: Command) => {
    const g = cmd.optsWithGlobals<GlobalOptions>();
    const schema = g.schema ?? env.schema();
    if (!o.yes)
      throw new UsageError(`this drops schema ${schema} and all its data; re-run with --yes`);
    const result = await resetSchema(env.ownerUrl(), schema);
    if (g.json) printJson(result);
    else
      out(
        `${pc.green('✓')} schema ${schema} recreated: ${result.seeded.users} users, ${result.seeded.policies} policies`,
      );
  });

// ── side effects: outbox, worker, mocks ──────────────────────────────────────────────────────

const outbox = program
  .command('outbox')
  .description('Transactional outbox of external side effects');

outbox
  .command('list')
  .option('--status <status>', 'PENDING, PROCESSING, DONE, FAILED or DEAD')
  .option('--claim <claim>', 'only this claim')
  .action(async (o: { status?: string; claim?: string }, cmd: Command) => {
    await withApp(cmd, async ({ service, ops }, g) => {
      const claimId = o.claim ? (await service.requireClaim(o.claim)).id : undefined;
      const list = await ops.outbox({
        ...(o.status ? { status: o.status.toUpperCase() as OutboxStatus } : {}),
        ...(claimId ? { claimId } : {}),
      });
      if (g.json) printJson(list);
      else renderOutbox(list);
    });
  });

outbox
  .command('process')
  .description('Deliver due messages now, in this process')
  .option('--once', 'a single batch instead of everything that is due')
  .action(async (o: { once?: boolean }, cmd: Command) => {
    await withApp(cmd, async (app, g) => {
      const worker = app.createWorker({ log: out });
      const result = o.once ? await worker.processOnce() : await worker.drain();
      if (g.json) printJson(result);
      else
        out(
          pc.dim(
            `leased ${result.leased} · done ${result.done} · retry later ${result.failed} · dead ${result.dead}`,
          ),
        );
    });
  });

outbox
  .command('retry')
  .description('Give a DEAD message a fresh set of attempts')
  .argument('<id>', 'outbox message id', wholeNumber)
  .action(async (id: number, _o: unknown, cmd: Command) => {
    await withApp(cmd, async ({ ops }) => {
      if (!(await ops.retryOutbox(id))) throw new UsageError(`outbox #${id} is not DEAD`);
      out(`${pc.green('✓')} outbox #${id} queued again`);
    });
  });

program
  .command('worker')
  .description('Long-running outbox worker (LISTEN/NOTIFY with polling fallback); Ctrl+C to stop')
  .option('--poll-ms <ms>', 'polling interval when no notification arrives', wholeNumber, 2000)
  .action(async (o: { pollMs: number }, cmd: Command) => {
    await withApp(cmd, async (app) => {
      const worker = app.createWorker({ log: out, pollMs: o.pollMs });
      const stop = new AbortController();
      process.once('SIGINT', () => stop.abort());
      process.once('SIGTERM', () => stop.abort());
      await worker.run(stop.signal);
      out(pc.dim('[worker] stopped'));
    });
  });

const system = program.command('system').description('Automatic (system) transitions');

system
  .command('run')
  .description(
    'Run automatic transitions whose conditions now hold, e.g. closing after the appeal window',
  )
  .option('--claim <claim>', 'only this claim')
  .option('--now <iso>', 'simulate a later time (forward only), e.g. 2026-12-01T00:00:00Z')
  .action(async (o: { claim?: string; now?: string }, cmd: Command) => {
    let clock: Clock | undefined;
    if (o.now) {
      const at = new Date(o.now);
      if (Number.isNaN(at.getTime())) throw new UsageError(`--now: invalid timestamp '${o.now}'`);
      if (at.getTime() < Date.now()) throw new UsageError('--now can only move time forward');
      clock = new ManualClock(at);
    }
    await withApp(
      cmd,
      async ({ service }, g) => {
        const results = await service.runSystem(o.claim);
        if (g.json) printJson(results);
        else if (results.length === 0)
          out(pc.dim('Nothing to do: no automatic transition is due.'));
        else for (const r of results) renderResult(r);
      },
      clock,
    );
  });

const mock = program.command('mock').description('Mock payment gateway and notification channel');
const gateway = mock.command('gateway').description('Mock payment gateway');

gateway
  .command('fail-next')
  .description('Make the next N payment calls fail (to watch retries and idempotency)')
  .argument('<n>', 'number of failures', wholeNumber)
  .action(async (n: number, _o: unknown, cmd: Command) => {
    await withApp(cmd, async ({ ops }) => {
      await ops.failNextPayments(n);
      out(`${pc.green('✓')} the next ${n} payment call(s) will fail`);
    });
  });

gateway
  .command('payments')
  .description('Payments received by the mock gateway')
  .option('--claim <claim>', 'only this claim')
  .action(async (o: { claim?: string }, cmd: Command) => {
    await withApp(cmd, async ({ service, ops }, g) => {
      const claimId = o.claim ? (await service.requireClaim(o.claim)).id : undefined;
      const list = await ops.payments(claimId);
      if (g.json) printJson(list);
      else renderPayments(list);
    });
  });

mock
  .command('notifications')
  .description('Notifications "sent" (stored in the database)')
  .option('--claim <claim>', 'only this claim')
  .option('--full', 'include message bodies (may contain medical details)')
  .action(async (o: { claim?: string; full?: boolean }, cmd: Command) => {
    await withApp(cmd, async ({ service, ops }, g) => {
      const claimId = o.claim ? (await service.requireClaim(o.claim)).id : undefined;
      const list = await ops.notifications(claimId);
      if (g.json) printJson(list);
      else renderNotifications(list, o.full);
    });
  });

program
  .command('interactive')
  .alias('i')
  .description(
    'Guided mode: pick a user, a claim and an action; inputs are prompted from the config',
  )
  .action(async (_o: unknown, cmd: Command) => {
    await withApp(cmd, (app) => runInteractive(app));
  });

// ── errors ───────────────────────────────────────────────────────────────────────────────────

const DB_HINTS: Record<string, string> = {
  ECONNREFUSED: 'Is PostgreSQL running at the host and port in DATABASE_URL?',
  '28P01': 'Password rejected: check the passwords in .env, then run `npm run db:setup`.',
  '3D000': 'The database does not exist: run `npm run db:setup`.',
  '3F000': 'The schema does not exist: run `npm run db:migrate`.',
  '42P01': 'Tables are missing: run `npm run db:migrate`.',
};

function errorJson(error: unknown) {
  if (error instanceof WorkflowError) return error.toJSON();
  if (error instanceof ConfigError)
    return { code: 'INVALID_CONFIG', source: error.source, issues: error.issues };
  const code = (error as { code?: string }).code;
  return {
    code: error instanceof UsageError ? 'USAGE' : (code ?? 'ERROR'),
    message: (error as Error).message,
  };
}

function report(error: unknown, json: boolean): number {
  if (json) printJson({ error: errorJson(error) });
  else {
    renderError(error);
    const hint = DB_HINTS[(error as { code?: string }).code ?? ''];
    if (hint) out(pc.dim(hint));
  }
  if (error instanceof WorkflowError) return 1;
  if (error instanceof ConfigError || error instanceof UsageError) return 2;
  return 3;
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  process.exitCode = report(error, Boolean(program.opts<GlobalOptions>().json));
}
