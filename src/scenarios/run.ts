// Runs the demo scenarios in one process on a fresh schema and prints (or, with --write, saves to
// docs/results) what happened. Usage: npm run scenarios -- [--write] [--keep] [--only 1,4]
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import {
  type AppContext,
  createApp,
  dropSchema,
  migrateSchema,
  seedSchema,
} from '../app/bootstrap';
import { ManualClock } from '../app/clock';
import { formatDateTime } from '../engine/templates';
import { env } from '../infra/env';
import { type ScenarioEnv, ScenarioRun } from './harness';
import {
  auditTrailsMarkdown,
  type ClaimTrail,
  deniedMarkdown,
  type ReportMeta,
  type ScenarioResult,
  scenariosMarkdown,
} from './report';
import { SCENARIOS } from './scenarios';

const CLOCK_START = '2026-10-20T03:00:00.000Z';
const RESULTS_DIR = 'docs/results';

interface Args {
  write: boolean;
  keep: boolean;
  tests: boolean;
  config: string;
  extension: string;
  only?: number[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    write: false,
    keep: false,
    tests: true,
    config: env.workflowConfig(),
    extension: 'config/examples/workflow.appeal.yaml',
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === '--write') args.write = true;
    else if (flag === '--keep') args.keep = true;
    else if (flag === '--no-tests') args.tests = false;
    else if (flag === '--config') args.config = value();
    else if (flag === '--extension') args.extension = value();
    else if (flag === '--only') args.only = value().split(',').map(Number);
    else
      throw new Error(
        `unknown option ${flag} (use --write, --keep, --no-tests, --config, --extension, --only)`,
      );
  }
  return args;
}

/** Reproducible UUIDs, so repeated runs write identical audit trails. */
function sequentialIds(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

function printScenario(r: ScenarioResult) {
  const mark = r.run.passed ? pc.green('PASS') : pc.red('FAIL');
  const claims = r.trails.map((t) => `${t.claim.claim_no} ${t.claim.state}`).join(', ');
  console.log(
    `\n${mark} ${pc.bold(`${r.scenario.id}. ${r.scenario.title}`)}${claims ? pc.dim(`  (${claims})`) : ''}`,
  );
  for (const step of r.run.steps) {
    if (step.kind === 'note' || step.kind === 'available') {
      console.log(pc.dim(`     ${step.outcome}`));
      continue;
    }
    const ok = step.ok ? pc.green('✓') : pc.red('‼');
    const who = step.actor ? `${step.actor}${step.role ? ` (${step.role})` : ''}` : '';
    const what = step.kind === 'action' ? (step.transition ?? '') : step.kind;
    const result = step.error
      ? `${pc.yellow(step.error.code)} ${pc.dim(step.error.message)}`
      : step.outcome;
    console.log(
      `   ${ok} ${pc.bold(what)} ${pc.dim(who)} ${step.claim ? pc.dim(step.claim) : ''}: ${result}`,
    );
    for (const a of step.automatic) console.log(pc.magenta(`       ⚙ ${a}`));
    for (const e of step.effects) console.log(pc.dim(`       ↳ ${e}`));
  }
  for (const c of r.run.checks) {
    console.log(
      `   ${c.ok ? pc.green('✓') : pc.red('✗')} ${c.label}${c.ok || !c.detail ? '' : pc.red(` — ${c.detail}`)}`,
    );
  }
}

/** Runs the whole test suite and saves its plain-text output next to the scenario results. */
function writeTestReport(): boolean {
  const run = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', '--reporter=verbose'],
    {
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    },
  );
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colour codes
  const text = `${run.stdout}${run.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  writeFileSync(join(RESULTS_DIR, 'test-report.txt'), text);
  return run.status === 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const schema = `scenarios_${stamp}`;
  await migrateSchema(env.ownerUrl(), schema);
  await seedSchema(env.ownerUrl(), schema);

  const clock = new ManualClock(CLOCK_START);
  const newId = sequentialIds();
  const base = await createApp({ configPath: args.config, schema, clock, newId });
  let extension: AppContext | undefined;
  const logs: string[] = [];
  const worker = base.createWorker({ workerId: 'scenario-worker', log: (line) => logs.push(line) });
  const scenarioEnv: ScenarioEnv = {
    base,
    clock,
    extension: async () => {
      extension ??= await createApp({ configPath: args.extension, schema, clock, newId });
      return extension;
    },
    deliver: async () => {
      logs.length = 0;
      await worker.drain();
      return [...logs];
    },
  };

  const results: ScenarioResult[] = [];
  try {
    console.log(
      pc.dim(
        `Running scenarios in schema ${schema} (simulated clock from ${formatDateTime(CLOCK_START)})`,
      ),
    );
    for (const scenario of SCENARIOS) {
      if (args.only && !args.only.includes(scenario.id)) continue;
      const run = new ScenarioRun(scenarioEnv);
      try {
        await scenario.run(run);
      } catch (error) {
        run.check(`the scenario ran to the end (${(error as Error).message})`, false);
      }
      const trails: ClaimTrail[] = [];
      for (const claimNo of run.claims) {
        const { claim, entries } = await run.service.audit(claimNo);
        const wf = await run.service.workflowFor(run.app.pool, claim);
        trails.push({
          scenario: scenario.id,
          claim,
          workflow_version: wf.version,
          entries,
          verify: await run.service.verify(claimNo),
        });
      }
      const result = { scenario, run, trails };
      results.push(result);
      printScenario(result);
    }

    const passed = results.filter((r) => r.run.passed).length;
    const summary = `${passed}/${results.length} scenarios passed`;
    console.log(
      `\n${passed === results.length ? pc.green(pc.bold(summary)) : pc.red(pc.bold(summary))}`,
    );
    if (passed !== results.length) process.exitCode = 1;

    if (args.write) {
      const ext = extension ?? (await scenarioEnv.extension());
      const meta: ReportMeta = {
        clock_start: CLOCK_START,
        base: {
          id: base.workflow.id,
          version: base.workflow.version,
          hash: base.workflow.hash,
          source: args.config,
        },
        extension: {
          id: ext.workflow.id,
          version: ext.workflow.version,
          hash: ext.workflow.hash,
          source: args.extension,
        },
      };
      const trails = results.flatMap((r) => r.trails);
      const claimNos = new Map(
        (await base.service.listClaims({ limit: 10_000 })).map((c) => [c.id, c.claim_no]),
      );
      mkdirSync(RESULTS_DIR, { recursive: true });
      writeFileSync(join(RESULTS_DIR, 'scenarios.md'), scenariosMarkdown(results, meta));
      writeFileSync(join(RESULTS_DIR, 'audit-trails.md'), auditTrailsMarkdown(trails, meta));
      writeFileSync(
        join(RESULTS_DIR, 'audit-trails.json'),
        `${JSON.stringify(
          {
            workflows: [meta.base, meta.extension],
            claims: trails.map((t) => ({
              scenario: t.scenario,
              claim: t.claim,
              verify: t.verify,
              entries: t.entries,
            })),
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(RESULTS_DIR, 'denied-attempts.md'),
        deniedMarkdown(await base.service.denied(), (id) => (id ? (claimNos.get(id) ?? id) : '—')),
      );
      console.log(
        pc.dim(
          `wrote ${RESULTS_DIR}/scenarios.md, audit-trails.md, audit-trails.json, denied-attempts.md`,
        ),
      );
    }
  } finally {
    await extension?.close();
    await base.close();
    if (args.keep) console.log(pc.dim(`kept schema ${schema} (inspect with --schema ${schema})`));
    else await dropSchema(env.ownerUrl(), schema);
  }

  if (args.write && args.tests) {
    console.log(pc.dim('running the test suite for docs/results/test-report.txt …'));
    const ok = writeTestReport();
    console.log(
      ok
        ? pc.dim(`wrote ${RESULTS_DIR}/test-report.txt`)
        : pc.red('test suite failed: see docs/results/test-report.txt'),
    );
    if (!ok) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(pc.red(`scenarios failed: ${(error as Error).message}`));
  process.exitCode = 1;
});
