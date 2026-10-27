// Shapes returned by the API (src/controllers/http/routes.ts). Domain records are shared with the server.
import type {
  AuditEntry,
  ClaimSnapshot,
  DeniedAttempt,
  JsonPatchOp,
  OutboxMessage,
  Policy,
  User,
} from '../../src/domain/types';

export type { AuditEntry, ClaimSnapshot, DeniedAttempt, JsonPatchOp, OutboxMessage, Policy, User };

export type InputType =
  | 'text'
  | 'string'
  | 'money'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'enum'
  | 'user_ref'
  | 'policy_ref';

export interface InputField {
  name: string;
  type: InputType;
  required?: boolean;
  label?: string;
  description?: string;
  enum?: string;
  role?: string;
  min?: number;
  max?: number;
  max_length?: number;
  values?: string[];
}

export interface AvailableCheck {
  stage: string;
  code: string;
  ok: boolean;
  message: string;
}

export interface AvailableTransition {
  id: string;
  label: string;
  kind: 'create' | 'move' | 'stay';
  to: string | null;
  roles: string[];
  automatic: boolean;
  role_ok: boolean;
  allowed: boolean;
  inputs: InputField[];
  checks: AvailableCheck[];
  acting_role: string;
}

export interface WorkflowSummary {
  id: string;
  version: number;
  label: string;
  config_hash: string;
  states: Array<{ name: string; label?: string; description?: string; terminal?: boolean }>;
  roles: Array<{ name: string; label?: string; service_account_only?: boolean }>;
  counters: Array<{ name: string; max: number }>;
  document_requirements: Record<string, string[]>;
  creation: { id: string; label: string; roles: string[]; inputs: InputField[] };
  transitions: Array<{
    id: string;
    label: string;
    kind: string;
    from: string[];
    to: string | null;
    roles: string[];
    automatic: boolean;
  }>;
  diagram: string;
}

export interface ClaimDetail {
  claim: ClaimSnapshot;
  policy: Policy | null;
  workflow: WorkflowSummary;
  diagram: string;
  acting?: { user_id: string; roles: string[] };
  available?: AvailableTransition[];
}

export type ClaimRow = ClaimSnapshot & { can_run?: string[] };

export interface ActResult {
  claim: ClaimSnapshot;
  entry: AuditEntry;
  outbox_ids: number[];
  automatic: ActResult[];
  replayed: boolean;
}

export interface VerifyReport {
  claim_no: string;
  ok: boolean;
  entries: number;
  head_hash: string | null;
  issues: Array<{ code: string; message: string; claim_seq?: number; diff?: JsonPatchOp[] }>;
}

export interface MockNotification {
  idempotency_key: string;
  template: string;
  channel: string;
  recipient: Record<string, unknown>;
  subject: string | null;
  body: string;
  sent_at: string;
}

/** RFC 9457 problem details with the workflow error members. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  failures?: Array<{ code: string; message: string }>;
  input_errors?: Array<{ input: string; message: string }>;
  available?: Array<{ transition: string; to: string | null; roles: string[] }>;
  path_to_target?: string[];
  required_roles?: string[];
  counter?: { name: string; value: number; max: number };
  hint?: string;
}

export interface Acting {
  userId: string;
  role?: string;
}
