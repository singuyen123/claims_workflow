import { WorkflowError } from '../../engine/errors';

/** RFC 9457 problem details; `code` and the workflow error details are extension members. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  [extension: string]: unknown;
}

/** An HTTP-level error that is not a workflow refusal (missing user header, bad body, …). */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const typeFor = (code: string) =>
  `urn:claims-workflow:problem:${code.toLowerCase().replace(/_/g, '-')}`;

/** "INVALID_TRANSITION" → "Invalid transition". */
const titleFor = (code: string) => {
  const words = code.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function toProblem(error: unknown): Problem {
  if (error instanceof WorkflowError) {
    return {
      type: typeFor(error.code),
      title: titleFor(error.code),
      status: error.status,
      detail: error.message,
      code: error.code,
      ...error.details,
    };
  }
  if (error instanceof HttpProblem) {
    return {
      type: typeFor(error.code),
      title: titleFor(error.code),
      status: error.status,
      detail: error.message,
      code: error.code,
      ...error.extensions,
    };
  }
  // Fastify's own client errors (malformed JSON, unsupported media type, …).
  const status = (error as { statusCode?: number }).statusCode;
  if (status && status >= 400 && status < 500) {
    return {
      type: typeFor('BAD_REQUEST'),
      title: 'Bad request',
      status,
      detail: (error as Error).message,
      code: 'BAD_REQUEST',
    };
  }
  return {
    type: typeFor('INTERNAL_ERROR'),
    title: 'Internal error',
    status: 500,
    detail: 'Unexpected server error; details are in the server log',
    code: 'INTERNAL_ERROR',
  };
}
