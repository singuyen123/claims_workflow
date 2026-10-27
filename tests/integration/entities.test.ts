import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDatabase, type TestDb } from '../helpers/pg-schema';

/** information_schema udt_name of each column type the entities use. */
const UDT: Record<string, string> = {
  text: 'text',
  integer: 'int4',
  bigint: 'int8',
  smallint: 'int2',
  boolean: 'bool',
  jsonb: 'jsonb',
  uuid: 'uuid',
  date: 'date',
  timestamptz: 'timestamptz',
  char: 'bpchar',
};

describe.skipIf(!hasDatabase)('TypeORM entities', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb('entities');
  });
  afterAll(() => db?.close());

  it('map every column of every table, with its type and nullability', async () => {
    const { rows } = await db.owner.query<{
      table_name: string;
      column_name: string;
      udt_name: string;
      is_nullable: string;
    }>(
      `SELECT table_name, column_name, udt_name, is_nullable FROM information_schema.columns
        WHERE table_schema = $1 AND table_name NOT IN ('migrations', 'typeorm_metadata')`,
      [db.schema],
    );
    const inDatabase = rows
      .map(
        (r) =>
          `${r.table_name}.${r.column_name} ${r.udt_name}${r.is_nullable === 'YES' ? ' null' : ''}`,
      )
      .sort();
    const inEntities = db.app.dataSource.entityMetadatas
      .flatMap((m) =>
        m.columns.map((c) => {
          const udt = UDT[String(c.type)] ?? String(c.type);
          return `${m.tableName}.${c.databaseName} ${c.isArray ? `_${udt}` : udt}${c.isNullable ? ' null' : ''}`;
        }),
      )
      .sort();
    expect(inEntities).toEqual(inDatabase);
  });
});
