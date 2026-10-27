// Maps HTTP requests to service inputs: each part is validated against its model in `./models`,
// then reshaped for the service. No business rules.
import type { FastifyRequest } from 'fastify';
import type { ActorRef, ClaimListQuery } from '../../services/claim-query-service';
import type { ActRequest, CreateRequest } from '../../services/claim-service';
import { ActionBody } from './models/action-body';
import { ActorHeaders } from './models/actor-headers';
import { ClaimParams, TransitionParams } from './models/claim-params';
import { IdempotencyHeaders } from './models/idempotency-headers';
import { ListClaimsQuery } from './models/list-claims-query';
import { parseModel } from './models/parse';

/** The acting user named in X-User-Id / X-Role. */
export function actor(request: FastifyRequest): ActorRef {
  const { user_id, role } = parseModel(ActorHeaders, request.headers, {
    part: 'headers',
    status: 401,
    code: 'AUTHENTICATION_REQUIRED',
  });
  return { user_id, ...(role ? { role } : {}) };
}

/** The claim named in /api/claims/:ref/… */
export function claimRef(request: FastifyRequest): string {
  return parseModel(ClaimParams, request.params, { part: 'path' }).ref;
}

/** The acting user and the body of POST /api/claims and of a transition. */
export function actionInput(request: FastifyRequest): CreateRequest {
  const who = actor(request);
  const body = parseModel(ActionBody, request.body ?? {}, { part: 'body' });
  const headers = parseModel(IdempotencyHeaders, request.headers, { part: 'headers' });
  const key = headers.idempotency_key || body.idempotency_key;
  return {
    user_id: who.user_id,
    input: body.input ?? {},
    ...(who.role ? { role: who.role } : {}),
    ...(body.expected_version != null ? { expected_version: body.expected_version } : {}),
    ...(key ? { idempotency_key: key } : {}),
  };
}

/** POST /api/claims/:ref/transitions/:transition */
export function transitionInput(request: FastifyRequest): ActRequest {
  const input = actionInput(request);
  const { ref, transition } = parseModel(TransitionParams, request.params, { part: 'path' });
  return { ...input, claim: ref, transition_id: transition };
}

/** GET /api/claims?state=A,B&limit=100&queue=1: claims the acting user may see, or can act on. */
export function listClaimsInput(request: FastifyRequest): ClaimListQuery {
  const who = actor(request);
  const { state, limit, queue } = parseModel(ListClaimsQuery, request.query, { part: 'query' });
  return {
    limit,
    viewer: { user_id: who.user_id },
    ...(state ? { states: state } : {}),
    ...(queue === '1' || queue === 'true' ? { queue_for: who } : {}),
  };
}
