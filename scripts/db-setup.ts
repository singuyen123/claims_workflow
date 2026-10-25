// One-time setup with the superuser connection (DATABASE_ADMIN_URL):
//   roles claims_owner (schema owner, runs migrations) and claims_app (runtime, least privilege),
//   databases for development and tests, and the development schema.
// Safe to re-run: existing roles get their passwords refreshed, existing databases are kept.
import pg from 'pg';
import { env, loadEnv } from '../src/infra/env';

const OWNER = 'claims_owner';
const APP = 'claims_app';
const NAME_RE = /^[a-z_][a-z0-9_]*$/;

function databaseName(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!NAME_RE.test(name)) throw new Error(`Unsupported database name '${name}' in ${url}`);
  return name;
}

async function ensureRole(admin: pg.Client, role: string, password: string) {
  const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  const verb = exists.rowCount ? 'ALTER' : 'CREATE';
  await admin.query(`${verb} ROLE ${role} LOGIN PASSWORD ${admin.escapeLiteral(password)}`);
  console.log(`${verb === 'CREATE' ? 'created' : 'updated'} role ${role}`);
}

async function ensureDatabase(admin: pg.Client, name: string) {
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (exists.rowCount) {
    console.log(`database ${name} exists`);
    return;
  }
  await admin.query(`CREATE DATABASE ${name} OWNER ${OWNER}`);
  console.log(`created database ${name}`);
}

async function main() {
  loadEnv();
  const ownerPassword = process.env.CLAIMS_OWNER_PASSWORD;
  const appPassword = process.env.CLAIMS_APP_PASSWORD;
  if (!ownerPassword || !appPassword) {
    throw new Error('Set CLAIMS_OWNER_PASSWORD and CLAIMS_APP_PASSWORD in .env');
  }

  const admin = new pg.Client({ connectionString: env.adminUrl() });
  await admin.connect();
  try {
    await ensureRole(admin, OWNER, ownerPassword);
    await ensureRole(admin, APP, appPassword);
    // Lets the owner `SET ROLE claims_app` in tests that check the runtime role's privileges.
    await admin.query(`GRANT ${APP} TO ${OWNER}`);
    for (const url of [env.databaseUrl(), env.testUrl()])
      await ensureDatabase(admin, databaseName(url));
  } finally {
    await admin.end();
  }

  const schema = env.schema();
  if (!NAME_RE.test(schema)) throw new Error(`Invalid DB_SCHEMA '${schema}'`);
  const owner = new pg.Client({ connectionString: env.ownerUrl() });
  await owner.connect();
  try {
    await owner.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    console.log(`schema ${schema} ready in ${databaseName(env.ownerUrl())}`);
  } finally {
    await owner.end();
  }
  console.log('Next: npm run db:migrate && npm run db:seed');
}

main().catch((error) => {
  console.error(`db:setup failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
