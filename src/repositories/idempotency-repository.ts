export interface IdempotencyRecord {
  key: string;
  actor_user_id: string;
  request_hash: string;
  claim_id: string | null;
  response: Record<string, unknown>;
  created_at: string;
}

export interface IdempotencyRepository {
  /**
   * Serialises requests that share a key until the transaction ends (including creations, which
   * have no row to lock). Only has an effect inside `UnitOfWork.transaction`.
   */
  lock(key: string): Promise<void>;
  find(key: string): Promise<IdempotencyRecord | null>;
  save(record: IdempotencyRecord): Promise<void>;
}
