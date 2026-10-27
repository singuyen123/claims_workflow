export const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);

export const isoOrNull = (v: unknown) => (v === null || v === undefined ? null : iso(v));
