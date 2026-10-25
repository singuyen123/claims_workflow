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
