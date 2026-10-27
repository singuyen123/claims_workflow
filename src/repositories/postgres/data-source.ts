import { DataSource } from 'typeorm';
import { MIGRATIONS } from '../../infra/db/migrations/index';
import { connectionOptions, types } from '../../infra/db/pool';
import { ENTITIES } from './entities/index';

/**
 * A TypeORM data source on one schema. Every connection uses the schema as its search_path
 * (sequences and trigger functions resolve through it) and the safe BIGINT/DATE parsers.
 * Call `initialize()` before use and `destroy()` when done.
 */
export function createDataSource(url: string, schema: string, max = 10): DataSource {
  return new DataSource({
    type: 'postgres',
    url,
    schema,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'each',
    synchronize: false,
    migrationsRun: false,
    // The runtime role may not create extensions, and no column needs one.
    installExtensions: false,
    logging: false,
    extra: { max, types, options: connectionOptions(schema) },
    // An idle connection dropped by the server (restart, timeout) must not crash the process;
    // the pool replaces it on the next query.
    poolErrorHandler: (error: Error) =>
      process.emitWarning(`PostgreSQL connection lost: ${error.message}`),
  });
}
