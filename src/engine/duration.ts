import { ISO_DURATION_RE } from './schema';

export interface Duration {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function isIsoDuration(value: unknown): value is string {
  return typeof value === 'string' && ISO_DURATION_RE.test(value);
}

export function parseDuration(value: string): Duration {
  const match =
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      value,
    );
  if (!match || !isIsoDuration(value)) {
    throw new Error(`Invalid ISO-8601 duration '${value}'`);
  }
  const n = (i: number) => Number(match[i] ?? 0);
  return {
    years: n(1),
    months: n(2),
    weeks: n(3),
    days: n(4),
    hours: n(5),
    minutes: n(6),
    seconds: n(7),
  };
}

/** Calendar-aware addition in UTC (P1M on Jan 31 gives the last day of February). */
export function addDuration(start: Date, duration: Duration | string): Date {
  const d = typeof duration === 'string' ? parseDuration(duration) : duration;
  const result = new Date(start.getTime());
  if (d.years || d.months) {
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + d.years * 12 + d.months);
    const lastDay = new Date(
      Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
    ).getUTCDate();
    result.setUTCDate(Math.min(day, lastDay));
  }
  const ms = ((((d.weeks * 7 + d.days) * 24 + d.hours) * 60 + d.minutes) * 60 + d.seconds) * 1000;
  return new Date(result.getTime() + ms);
}

/** Accepts `YYYY-MM-DD` (UTC midnight) or a full ISO timestamp. */
export function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== 'string') return undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
