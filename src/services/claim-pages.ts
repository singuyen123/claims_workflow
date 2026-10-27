import type { ClaimFilter, ClaimSnapshot } from '../domain/types';
import type { ClaimRepository } from '../repositories/claim-repository';

/**
 * Every claim matching `filter`, newest first, read one page at a time. Batch jobs (scheduler
 * pass, verify of every claim, work queues) use this instead of one capped list, which would
 * silently leave out older claims.
 */
export async function* eachClaim(
  claims: ClaimRepository,
  filter: Omit<ClaimFilter, 'limit' | 'after'> = {},
  pageSize = 200,
): AsyncGenerator<ClaimSnapshot> {
  let after: ClaimFilter['after'];
  for (;;) {
    const page = await claims.list({ ...filter, limit: pageSize, ...(after ? { after } : {}) });
    yield* page;
    const last = page.at(-1);
    if (!last || page.length < pageSize) return;
    after = { created_at: last.created_at, claim_no: last.claim_no };
  }
}
