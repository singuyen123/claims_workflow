import pg from 'pg';

const INT8_OID = 20;
const DATE_OID = 1082;

function parseInt8(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`BIGINT ${value} exceeds Number.MAX_SAFE_INTEGER`);
  return n;
}

// BIGINT → number (amounts are CHECKed below 2^53); DATE → 'YYYY-MM-DD' string, because the
// default parser turns dates into local-midnight Date objects that shift across time zones.
export const types = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (oid === INT8_OID) return parseInt8;
    if (oid === DATE_OID) return (value: string) => value;
    return pg.types.getTypeParser(oid, format);
  },
};

export const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;

/** Connection settings every connection gets: `schema` as its search_path, and UTC. */
export function connectionOptions(schema: string): string {
  if (!SCHEMA_RE.test(schema)) throw new Error(`Invalid schema name '${schema}'`);
  return `-c search_path=${schema} -c TimeZone=UTC`;
}

/**
 * A plain pg pool whose connections all use `schema` as their search_path. The application
 * goes through TypeORM; this is for database maintenance scripts and for tests and demos that
 * check privileges and triggers directly.
 */
export function createPool(connectionString: string, schema: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString, max, types, options: connectionOptions(schema) });
  // An idle connection dropped by the server (restart, timeout) must not crash the process;
  // the pool replaces it on the next query.
  pool.on('error', (error) => process.emitWarning(`PostgreSQL connection lost: ${error.message}`));
  return pool;
}
