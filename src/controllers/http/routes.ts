import Fastify, { type FastifyInstance } from 'fastify';
import type { Services } from '../../services/index';
import { HttpProblem, toProblem } from './problem';
import {
  actionInput,
  type ClaimParams,
  type ClaimsQuery,
  listClaimsInput,
  optionalActor,
  type TransitionParams,
  transitionInput,
} from './requests';

export interface ServerOptions {
  /** One line per request (method, path, status, duration); never bodies, which hold PII. */
  log?: (line: string) => void;
}

/** HTTP controller: every route maps the request, calls one service method and returns. */
export async function buildServer(
  services: Services,
  options: ServerOptions = {},
): Promise<FastifyInstance> {
  const { claims, queries, workflows, operations } = services;
  const server = Fastify({ logger: false });

  server.setErrorHandler((error, request, reply) => {
    const problem = toProblem(error);
    if (problem.status >= 500)
      console.error(`[api] ${request.method} ${request.url} failed:`, error);
    reply.status(problem.status).type('application/problem+json').send(problem);
  });
  server.setNotFoundHandler((request, reply) => {
    const problem = toProblem(
      new HttpProblem(404, 'NOT_FOUND', `No route for ${request.method} ${request.url}`),
    );
    reply.status(404).type('application/problem+json').send(problem);
  });
  if (options.log) {
    const log = options.log;
    server.addHook('onResponse', async (request, reply) => {
      log(
        `[api] ${request.method} ${request.url} → ${reply.statusCode} (${Math.round(reply.elapsedTime)} ms)`,
      );
    });
  }

  server.get('/api/health', async () => workflows.health());

  server.get('/api/workflow', async () => workflows.describe());

  server.get('/api/users', async () => operations.people());

  server.get('/api/policies', async () => operations.policies());

  server.get<{ Querystring: ClaimsQuery }>('/api/claims', async (request) =>
    queries.listClaims(listClaimsInput(request)),
  );

  server.post('/api/claims', async (request, reply) => {
    const result = await claims.create(actionInput(request));
    reply.status(result.replayed ? 200 : 201);
    return result;
  });

  server.get<{ Params: ClaimParams }>('/api/claims/:ref', async (request) =>
    queries.detail(request.params.ref, optionalActor(request)),
  );

  server.post<{ Params: TransitionParams }>(
    '/api/claims/:ref/transitions/:transition',
    async (request) => claims.act(transitionInput(request)),
  );

  server.get<{ Params: ClaimParams }>('/api/claims/:ref/audit', async (request) =>
    queries.auditEntries(request.params.ref),
  );

  server.get<{ Params: ClaimParams }>('/api/claims/:ref/denied', async (request) =>
    queries.denied(request.params.ref),
  );

  server.get<{ Params: ClaimParams }>('/api/claims/:ref/verify', async (request) =>
    queries.verify(request.params.ref),
  );

  server.get<{ Params: ClaimParams }>('/api/claims/:ref/notifications', async (request) =>
    operations.notifications(request.params.ref),
  );

  server.get<{ Params: ClaimParams }>('/api/claims/:ref/outbox', async (request) =>
    operations.outbox({ claim: request.params.ref }),
  );

  /** Fires time-based automatic transitions now (what a scheduler would do periodically). */
  server.post('/api/system/run', async () => ({ results: await claims.runSystem() }));

  return server;
}
