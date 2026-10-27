import type { ClaimFilter, ClaimSnapshot } from '../domain/types';

export interface ClaimRepository {
  /**
   * Finds a claim by claim number (CLM-…) or id. `lock` takes a row lock that lasts until the
   * transaction ends, so it only has an effect inside `UnitOfWork.transaction`.
   */
  find(ref: string, options?: { lock?: boolean }): Promise<ClaimSnapshot | null>;
  insert(claim: ClaimSnapshot): Promise<void>;
  /** Optimistic update: returns false when the stored version is no longer `expectedVersion`. */
  update(claim: ClaimSnapshot, expectedVersion: number): Promise<boolean>;
  /** Next claim number of the year (CLM-YYYY-NNNNNN); numbers are never reused. */
  nextClaimNo(year: number): Promise<string>;
  /** Newest first; `filter.after` continues from a claim of the previous page. */
  list(filter?: ClaimFilter): Promise<ClaimSnapshot[]>;
}
