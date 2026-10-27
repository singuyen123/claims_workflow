import { existsSync } from 'node:fs';

let loaded = false;

/** Loads `.env` once (Node's built-in loader); variables already set in the shell win. */
export function loadEnv(path = '.env') {
  if (loaded) return;
  loaded = true;
  if (existsSync(path)) process.loadEnvFile(path);
}

function required(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in (see README).`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  loadEnv();
  return process.env[name] || fallback;
}

export const env = {
  databaseUrl: () => required('DATABASE_URL'),
  ownerUrl: () => required('DATABASE_OWNER_URL'),
  adminUrl: () => required('DATABASE_ADMIN_URL'),
  testUrl: () => required('TEST_DATABASE_URL'),
  schema: () => optional('DB_SCHEMA', 'claims'),
  workflowConfig: () => optional('WORKFLOW_CONFIG', 'config/workflow.yaml'),
  /**
   * The audit chain's HMAC key. There is no fallback: a key anyone can read in the source would
   * let anyone with write access to the database re-sign a rewritten history.
   */
  auditKey: () => {
    const key = required('AUDIT_HMAC_KEY');
    if (key.length < 16) throw new Error('AUDIT_HMAC_KEY must be at least 16 characters long.');
    if (process.env.NODE_ENV === 'production' && PUBLISHED_KEYS.has(key)) {
      throw new Error('AUDIT_HMAC_KEY is an example value from this repository; set a secret one.');
    }
    return key;
  },
};

/** Keys printed in .env.example and the CI workflow. */
const PUBLISHED_KEYS = new Set(['dev-only-change-me', 'ci-only-not-secret']);
