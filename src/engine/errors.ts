export type ErrorCode =
  | 'UNKNOWN_TRANSITION'
  | 'CLAIM_NOT_FOUND'
  | 'TERMINAL_STATE'
  | 'INVALID_TRANSITION'
  | 'CONCURRENT_MODIFICATION'
  | 'UNKNOWN_USER'
  | 'ROLE_NOT_ASSIGNED'
  | 'ROLE_REQUIRED'
  | 'SERVICE_ACCOUNT_ONLY'
  | 'UNAUTHORIZED_ROLE'
  | 'INVALID_INPUT'
  | 'ACCESS_DENIED'
  | 'CYCLE_LIMIT_EXCEEDED'
  | 'ACTION_LIMIT_EXCEEDED'
  | 'PRECONDITION_FAILED'
  | 'IDEMPOTENCY_KEY_REUSED';

export const HTTP_STATUS: Record<ErrorCode, number> = {
  UNKNOWN_TRANSITION: 400,
  CLAIM_NOT_FOUND: 404,
  TERMINAL_STATE: 409,
  INVALID_TRANSITION: 409,
  CONCURRENT_MODIFICATION: 409,
  UNKNOWN_USER: 401,
  ROLE_NOT_ASSIGNED: 403,
  ROLE_REQUIRED: 400,
  SERVICE_ACCOUNT_ONLY: 403,
  UNAUTHORIZED_ROLE: 403,
  INVALID_INPUT: 400,
  ACCESS_DENIED: 403,
  CYCLE_LIMIT_EXCEEDED: 422,
  ACTION_LIMIT_EXCEEDED: 422,
  PRECONDITION_FAILED: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
};

/** One failed rule. `code` comes from the config (e.g. DOCUMENTS_MISSING) or a primitive default. */
export interface Failure {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface TransitionHint {
  transition: string;
  to: string | null;
  roles: string[];
}

export interface WorkflowErrorDetails {
  claim_no?: string;
  state?: string;
  transition?: string;
  failures?: Failure[];
  available?: TransitionHint[];
  path_to_target?: string[];
  required_roles?: string[];
  counter?: { name: string; value: number; max: number };
  input_errors?: Array<{ input: string; message: string }>;
  expected_version?: number;
  current_version?: number;
  hint?: string;
}

export class WorkflowError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: WorkflowErrorDetails = {},
  ) {
    super(message);
    this.name = 'WorkflowError';
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }

  toJSON() {
    return { code: this.code, message: this.message, ...this.details };
  }
}
