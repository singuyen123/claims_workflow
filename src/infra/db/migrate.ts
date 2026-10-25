import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { sha256Hex } from '../../engine/hash';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

function migrationFiles(): Array<{ version: string; sql: string; checksum: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replace(/\r\n/g, '\n');
      return { version: file.replace(/\.sql$/, ''), sql, checksum: sha256Hex(sql) };
    });
}

/**
 * Applies pending migrations in order, each in its own transaction, in the pool's schema.
 * An applied migration whose file content changed is an error: migrations are append-only.
 */
export async function migrate(pool: pg.Pool): Promise<MigrationResult> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        checksum   text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const result: MigrationResult = { applied: [], skipped: [] };
    for (const m of migrationFiles()) {
      const previous = applied.get(m.version);
      if (previous) {
        if (previous !== m.checksum) {
          throw new Error(
            `Migration ${m.version} was modified after it was applied (checksum mismatch). Add a new migration instead.`,
          );
        }
        result.skipped.push(m.version);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
          m.version,
          m.checksum,
        ]);
        await client.query('COMMIT');
        result.applied.push(m.version);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${m.version} failed: ${(error as Error).message}`);
      }
    }
    return result;
  } finally {
    client.release();
  }
}
