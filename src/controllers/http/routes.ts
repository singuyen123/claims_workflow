import Fastify, { type FastifyInstance } from 'fastify';
import type { Services } from '../../services/index';
import { HttpProblem, toProblem } from './problem';
import { actionInput, actor, claimRef, listClaimsInput, transitionInput } from './requests';

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

  // Demo authentication: the web UI lists the people one can act as before anyone is chosen.
  server.get('/api/users', async () => operations.people());

  server.get('/api/policies', async (request) => operations.policies(actor(request)));

  server.get('/api/claims', async (request) => queries.listClaims(listClaimsInput(request)));

  server.post('/api/claims', async (request, reply) => {
    const result = await claims.create(actionInput(request));
    reply.status(result.replayed ? 200 : 201);
    return result;
  });

  server.get('/api/claims/:ref', async (request) =>
    queries.detail(claimRef(request), actor(request)),
  );

  server.post('/api/claims/:ref/transitions/:transition', async (request) =>
    claims.act(transitionInput(request)),
  );

  server.get('/api/claims/:ref/audit', async (request) =>
    queries.auditEntries(claimRef(request), {}, actor(request)),
  );

  server.get('/api/claims/:ref/denied', async (request) =>
    queries.denied(claimRef(request), actor(request)),
  );

  server.get('/api/claims/:ref/verify', async (request) =>
    queries.verify(claimRef(request), actor(request)),
  );

  server.get('/api/claims/:ref/notifications', async (request) =>
    operations.notifications(claimRef(request), actor(request)),
  );

  server.get('/api/claims/:ref/outbox', async (request) =>
    operations.outbox({ claim: claimRef(request) }, actor(request)),
  );

  /** Fires time-based automatic transitions now (what a scheduler would do periodically). */
  server.post('/api/system/run', async (request) => claims.runSystem(undefined, actor(request)));

  return server;
}
