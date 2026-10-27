import { describe, expect, it } from 'vitest';
import { RETRY_POLICIES, retryDelayMs } from '../../src/services/retry-policy';

/** Total wait from the first attempt to the last, with the jitter fixed at `random`. */
const total = (type: keyof typeof RETRY_POLICIES, random: number) => {
  const policy = RETRY_POLICIES[type];
  let ms = 0;
  for (let attempt = 1; attempt < policy.maxAttempts; attempt++) {
    ms += retryDelayMs(policy, attempt, () => random);
  }
  return ms;
};

const HOUR = 3_600_000;

describe('retry policy', () => {
  it('doubles the delay up to the cap, with up to half of it random', () => {
    const policy = { maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 5000 };
    expect([1, 2, 3, 4].map((a) => retryDelayMs(policy, a, () => 0.999_999))).toEqual([
      1000, 2000, 4000, 5000,
    ]);
    expect([1, 2, 3, 4].map((a) => retryDelayMs(policy, a, () => 0))).toEqual([
      500, 1000, 2000, 2500,
    ]);
  });

  it('keeps retrying a payment for hours, notifications for minutes', () => {
    expect(total('trigger_payment', 0)).toBeGreaterThan(6 * HOUR);
    expect(total('trigger_payment', 1)).toBeLessThan(14 * HOUR);
    expect(total('notify', 0)).toBeGreaterThan(15 * 60_000);
    expect(total('notify', 1)).toBeLessThan(HOUR);
  });
});
