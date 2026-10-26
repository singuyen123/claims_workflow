import type { AuditEntry, DeniedAttempt } from '../domain/types';

export interface ChainHead {
  claim_seq: number;
  hash: string;
}

/** The append-only, hash-chained audit trail. */
export interface AuditRepository {
  insert(entry: AuditEntry): Promise<void>;
  /** A claim's entries in chain order. */
  list(claimId: string): Promise<AuditEntry[]>;
  find(entryId: string): Promise<AuditEntry | null>;
  /** Last link of a claim's chain. Call after locking the claim row. */
  head(claimId: string): Promise<ChainHead | null>;
}

export interface DeniedRecord {
  claim_id: string | null;
  actor_user_id: string;
  actor_role: string | null;
  transition_id: string;
  error_code: string;
  message: string;
  details: Record<string, unknown>;
  occurred_at: string;
}

/** Refused attempts, kept apart from the audit chain. */
export interface DeniedAttemptRepository {
  /**
   * Records a refused attempt, at most once per (claim, user, transition, code) and minute.
   * Returns false when an identical refusal was already recorded in the same minute.
   */
  record(denied: DeniedRecord): Promise<boolean>;
  list(claimId?: string): Promise<DeniedAttempt[]>;
}
