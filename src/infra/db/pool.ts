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
const types = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (oid === INT8_OID) return parseInt8;
    if (oid === DATE_OID) return (value: string) => value;
    return pg.types.getTypeParser(oid, format);
  },
};

export const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;

/** A pool whose connections all use `schema` as their search_path. */
export function createPool(connectionString: string, schema: string, max = 10): pg.Pool {
  if (!SCHEMA_RE.test(schema)) throw new Error(`Invalid schema name '${schema}'`);
  const pool = new pg.Pool({
    connectionString,
    max,
    types,
    options: `-c search_path=${schema} -c TimeZone=UTC`,
  });
  // An idle connection dropped by the server (restart, timeout) must not crash the process;
  // the pool replaces it on the next query.
  pool.on('error', (error) => process.emitWarning(`PostgreSQL connection lost: ${error.message}`));
  return pool;
}

export type Db = pg.Pool | pg.PoolClient;

/** Runs `fn` in a transaction on its own connection. */
export async function inTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
