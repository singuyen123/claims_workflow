export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock that only moves when told to; used by tests, scenarios and `system run --now`. */
export class ManualClock implements Clock {
  private current: number;

  constructor(start: Date | string = '2026-10-20T03:00:00.000Z') {
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): Date {
    this.current += ms;
    return this.now();
  }

  set(date: Date | string): void {
    this.current = new Date(date).getTime();
  }
}

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

/** Never earlier than 1 ms after `previousIso`, so a claim's timestamps strictly increase. */
export function monotonic(now: Date, previousIso: string | undefined): Date {
  if (!previousIso) return now;
  return new Date(Math.max(now.getTime(), Date.parse(previousIso) + 1));
}
