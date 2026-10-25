// Shows what protects the audit trail, in a scratch schema that is dropped afterwards:
// 1. the database refuses direct edits (append-only triggers, deferred audit check, privileges);
// 2. an owner who disables the triggers is still caught by `verify`.
// Usage: npm run demo:tamper [-- --keep]
import type pg from 'pg';
import pc from 'picocolors';
import { createApp, dropSchema, migrateSchema, seedSchema } from '../app/bootstrap';
import { ManualClock } from '../app/clock';
import type { VerifyReport } from '../app/verify';
import { createPool } from '../infra/db/pool';
import { env } from '../infra/env';
import { ScenarioRun } from './harness';

const say = (line = '') => console.log(line);

async function attempt(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    say(`  ${pc.red('✗')} ${label}: ${pc.red('accepted')}`);
  } catch (error) {
    say(`  ${pc.green('✓')} ${label}: ${pc.dim((error as Error).message)}`);
  }
}

/** As the schema owner, with the table's user triggers disabled for one statement. */
async function bypass(owner: pg.Pool, table: string, sql: string, params: unknown[]) {
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await client.query(sql, params);
    await client.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function printReport(report: VerifyReport) {
  if (report.ok) {
    say(
      `  ${pc.green('✓ verify')}: ${report.entries} entries, chain intact, replay matches, claim row matches`,
    );
    return;
  }
  for (const issue of report.issues) {
    say(
      `  ${pc.red(`✗ ${issue.code}`)}${issue.claim_seq ? ` (#${issue.claim_seq})` : ''}: ${issue.message}`,
    );
    for (const op of issue.diff ?? []) {
      say(pc.dim(`      ${op.op} ${op.path} = ${JSON.stringify(op.value)}`));
    }
  }
}

async function main() {
  const keep = process.argv.includes('--keep');
  const schema = `tamper_demo_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  await migrateSchema(env.ownerUrl(), schema);
  await seedSchema(env.ownerUrl(), schema);
  const clock = new ManualClock();
  const app = await createApp({ schema, clock });
  const owner = createPool(env.ownerUrl(), schema, 2);
  try {
    const s = new ScenarioRun({
      base: app,
      clock,
      extension: () => Promise.reject(new Error('not used')),
      deliver: async () => [],
    });
    const claimNo = await s.submit();
    await s.toAssessment(claimNo);
    await s.assess(claimNo, 2_000_000);
    await s.act(claimNo, 'approve', 'u_assessor_01');
    const claim = await s.claim(claimNo);
    say(
      pc.bold(
        `${claimNo} approved for 2,000,000 VND (${claim.version} audit entries) in schema ${schema}`,
      ),
    );
    printReport(await app.service.verify(claimNo));

    say();
    say(pc.bold('1. The database refuses edits made behind the engine'));
    await attempt('owner: UPDATE audit_log', () =>
      owner.query(`UPDATE audit_log SET reason = 'edited' WHERE claim_id = $1`, [claim.id]),
    );
    await attempt('owner: TRUNCATE audit_log', () => owner.query('TRUNCATE audit_log CASCADE'));
    await attempt('owner: change the approved amount without an audit entry', () =>
      owner.query(
        `UPDATE claims SET version = version + 1,
                data = jsonb_set(data, '{assessment,approved_amount}', '90000000') WHERE id = $1`,
        [claim.id],
      ),
    );
    await attempt('app role: DELETE FROM audit_log', () => app.pool.query('DELETE FROM audit_log'));
    await attempt('app role: UPDATE claims SET state', () =>
      app.pool.query(`UPDATE claims SET state = 'CLOSED', version = version + 1 WHERE id = $1`, [
        claim.id,
      ]),
    );
    printReport(await app.service.verify(claimNo));

    say();
    say(pc.bold('2. An owner disables the triggers and edits the claim row'));
    await bypass(
      owner,
      'claims',
      `UPDATE claims SET data = jsonb_set(data, '{assessment,approved_amount}', '90000000') WHERE id = $1`,
      [claim.id],
    );
    printReport(await app.service.verify(claimNo));

    say();
    say(pc.bold('3. … and rewrites who approved it in the audit log'));
    await bypass(
      owner,
      'audit_log',
      `UPDATE audit_log SET actor_user_id = 'u_lead_01' WHERE claim_id = $1 AND transition_id = 'approve'`,
      [claim.id],
    );
    printReport(await app.service.verify(claimNo));
    say();
    say(
      pc.dim(
        'The HMAC key is not in the database, so a consistent forgery also needs the key. In production keep it in a KMS and anchor chain heads outside the database.',
      ),
    );
  } finally {
    await owner.end();
    await app.close();
    if (keep) say(pc.dim(`kept schema ${schema}`));
    else await dropSchema(env.ownerUrl(), schema);
  }
}

main().catch((error) => {
  console.error(pc.red(`demo:tamper failed: ${(error as Error).message}`));
  process.exitCode = 1;
});
