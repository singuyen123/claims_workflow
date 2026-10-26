// Maps HTTP requests to service inputs: headers, body and query parameters. No business rules.
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ActorRef, ClaimListQuery } from '../../services/claim-query-service';
import type { ActRequest, CreateRequest } from '../../services/claim-service';
import { HttpProblem } from './problem';

export interface ClaimParams {
  ref: string;
}

export interface TransitionParams extends ClaimParams {
  transition: string;
}

export interface ClaimsQuery {
  state?: string;
  queue?: string;
  limit?: string;
}

const ActBody = z.strictObject({
  input: z.record(z.string(), z.unknown()).optional(),
  expected_version: z.number().int().min(1).optional(),
  idempotency_key: z.string().optional(),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`);
    throw new HttpProblem(400, 'BAD_REQUEST', `Invalid request body: ${issues.join('; ')}`);
  }
  return result.data;
}

/**
 * Demo authentication: the caller names the acting user (and optionally the role) in headers.
 * A real deployment would take both from a verified identity token instead.
 */
export function actor(request: FastifyRequest): ActorRef {
  const userId = request.headers['x-user-id'];
  if (typeof userId !== 'string' || userId === '') {
    throw new HttpProblem(
      401,
      'AUTHENTICATION_REQUIRED',
      'Name the acting user in the X-User-Id header',
    );
  }
  const role = request.headers['x-role'];
  return { user_id: userId, ...(typeof role === 'string' && role !== '' ? { role } : {}) };
}

/** The acting user when the request names one. */
export function optionalActor(request: FastifyRequest): ActorRef | undefined {
  return request.headers['x-user-id'] ? actor(request) : undefined;
}

function idempotencyKey(request: FastifyRequest, body: { idempotency_key?: string | undefined }) {
  const header = request.headers['idempotency-key'];
  return typeof header === 'string' && header !== '' ? header : body.idempotency_key;
}

/** The acting user and the body of POST /api/claims and of a transition. */
export function actionInput(request: FastifyRequest): CreateRequest {
  const who = actor(request);
  const body = parseBody(ActBody, request.body);
  const key = idempotencyKey(request, body);
  return {
    user_id: who.user_id,
    input: body.input ?? {},
    ...(who.role ? { role: who.role } : {}),
    ...(body.expected_version !== undefined ? { expected_version: body.expected_version } : {}),
    ...(key ? { idempotency_key: key } : {}),
  };
}

/** POST /api/claims/:ref/transitions/:transition */
export function transitionInput(request: FastifyRequest<{ Params: TransitionParams }>): ActRequest {
  return {
    ...actionInput(request),
    claim: request.params.ref,
    transition_id: request.params.transition,
  };
}

/** GET /api/claims?state=A,B&limit=100&queue=1 (the queue needs the acting user). */
export function listClaimsInput(
  request: FastifyRequest<{ Querystring: ClaimsQuery }>,
): ClaimListQuery {
  const { state, queue, limit } = request.query;
  return {
    limit: Math.min(Number(limit) || 100, 500),
    ...(state ? { states: state.split(',') } : {}),
    ...(queue === '1' || queue === 'true' ? { queue_for: actor(request) } : {}),
  };
}
