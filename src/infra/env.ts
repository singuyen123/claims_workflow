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
  auditKey: () => {
    loadEnv();
    const key = process.env.AUDIT_HMAC_KEY;
    if (!key) {
      process.emitWarning('AUDIT_HMAC_KEY is not set; using an insecure development key.');
      return 'dev-only-insecure-key';
    }
    return key;
  },
};
