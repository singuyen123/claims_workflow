import type { OutboxMessage } from '../domain/types';

export interface RetryPolicy {
  /** Attempts before the message is DEAD (stored on the message when it is queued). */
  maxAttempts: number;
  /** Delay after the first failed attempt; it doubles after each further failure. */
  baseDelayMs: number;
  /** Longest delay between two attempts. */
  maxDelayMs: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * How long each kind of side effect is worth retrying. Effect types are engine primitives, not
 * workflow names, so the schedule lives here rather than in the workflow file.
 */
export const RETRY_POLICIES: Record<OutboxMessage['effect_type'], RetryPolicy> = {
  // A payment gateway outage can last hours, and the member is owed the money: keep trying for
  // 6 to 13 hours (30 s doubling to one attempt an hour) before an operator has to step in.
  trigger_payment: { maxAttempts: 20, baseDelayMs: 30 * SECOND, maxDelayMs: HOUR },
  // A notification is still useful a little later, a stale one much less: 20 to 40 minutes.
  notify: { maxAttempts: 10, baseDelayMs: 5 * SECOND, maxDelayMs: 15 * MINUTE },
  // Console lines: about 15 seconds.
  log: { maxAttempts: 5, baseDelayMs: SECOND, maxDelayMs: MINUTE },
};

/** Every external effect type. */
export const EFFECT_TYPES = Object.keys(RETRY_POLICIES) as Array<OutboxMessage['effect_type']>;

/**
 * Delay after the `attempt`-th failed attempt: exponential and capped, with equal jitter (half
 * of it fixed, half random) so that messages failing together, as in an outage, do not all
 * retry at the same moment. `random` returns a number in [0, 1).
 */
export function retryDelayMs(
  policy: RetryPolicy,
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** Math.max(0, attempt - 1),
  );
  return Math.round(exponential / 2 + (exponential / 2) * random());
}
