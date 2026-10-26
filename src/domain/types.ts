/** Current state of a claim as stored in the `claims` table (business columns only). */
export interface ClaimSnapshot {
  id: string;
  claim_no: string;
  config_hash: string;
  policy_id: string;
  member_id: string;
  claim_type: string;
  claimed_amount: number;
  state: string;
  state_entered_at: string;
  version: number;
  /** Config-declared fields (`fields:` in the workflow file). */
  data: Record<string, unknown>;
  /** Named loop counters (`counters:` in the workflow file). */
  counters: Record<string, number>;
  /** Transition id → users who performed it on this claim (used for segregation of duties). */
  participants: Record<string, string[]>;
  created_at: string;
  updated_at: string;
}

export interface Policy {
  id: string;
  member_id: string;
  product: string;
  coverage_limit: number;
  currency: 'VND';
  /** YYYY-MM-DD */
  effective_from: string;
  /** YYYY-MM-DD */
  effective_to: string;
}

export interface User {
  id: string;
  display_name: string;
  roles: string[];
  member_id: string | null;
  service_account: boolean;
}

/** The user performing an action, acting in exactly one of their roles. */
export interface Actor {
  user_id: string;
  role: string;
  member_id: string | null;
  roles_held: string[];
  service_account: boolean;
}

export interface JsonPatchOp {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

/** One row of the append-only, hash-chained audit trail. */
export interface AuditEntry {
  entry_id: string;
  claim_id: string;
  claim_seq: number;
  transition_id: string;
  /** Null for the claim-creation entry. */
  from_state: string | null;
  to_state: string;
  actor_user_id: string;
  actor_role: string;
  reason: string | null;
  notes: string | null;
  input: Record<string, unknown>;
  /** RFC 6902 patch from the previous snapshot to this one. */
  changes: JsonPatchOp[];
  /** Values and checks the decision was based on, plus the config hash. */
  decision_context: Record<string, unknown>;
  effects: Array<Record<string, unknown>>;
  config_hash: string;
  claim_version: number;
  /** SHA-256 of the claim snapshot after this entry. */
  snapshot_hash: string;
  prev_hash: string;
  /** HMAC-SHA256 over every field above. */
  hash: string;
  occurred_at: string;
}

export interface DeniedAttempt {
  id: number;
  claim_id: string | null;
  actor_user_id: string;
  actor_role: string | null;
  transition_id: string;
  error_code: string;
  message: string;
  details: Record<string, unknown>;
  occurred_at: string;
}

/** Filter for listing claims. */
export interface ClaimFilter {
  states?: string[];
  assessorId?: string;
  memberId?: string;
  limit?: number;
}

/** A workflow definition as registered in `workflow_definitions`. */
export interface StoredDefinition {
  config_hash: string;
  workflow_id: string;
  version: number;
  content: unknown;
  registered_at: string;
}

export type DefinitionSummary = Omit<StoredDefinition, 'content'>;

/** A payment received by the mock payment gateway. */
export interface MockPayment {
  idempotency_key: string;
  claim_id: string;
  amount: number;
  reference: string;
  gateway_ref: string;
  created_at: string;
}

/** A notification "sent" through the mock notification channel. */
export interface MockNotification {
  idempotency_key: string;
  claim_id: string;
  template: string;
  channel: string;
  recipient: Record<string, unknown>;
  subject: string | null;
  body: string;
  sent_at: string;
}

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'DEAD';

export interface OutboxMessage {
  id: number;
  claim_id: string;
  audit_entry_id: string;
  effect_type: 'notify' | 'trigger_payment' | 'log';
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: OutboxStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_by: string | null;
  locked_until: string | null;
  last_error: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  processed_at: string | null;
}
