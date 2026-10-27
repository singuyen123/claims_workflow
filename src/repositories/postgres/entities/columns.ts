/** A jsonb value: any JSON object or array (TypeORM's write types cannot take `unknown`). */
export type Json = object;

/**
 * A row as TypeORM reads and writes it: timestamptz columns come back as Date objects (and
 * accept ISO strings), jsonb columns hold any JSON.
 */
export type Row<T, Timestamps extends keyof T, JsonColumns extends keyof T = never> = Omit<
  T,
  Timestamps | JsonColumns
> & { [K in Timestamps]: Date | string } & { [K in JsonColumns]: Json };

/** Identity primary key (GENERATED ALWAYS): never written by the application. */
export const identity = { type: 'bigint', primary: true, generated: 'increment' } as const;
