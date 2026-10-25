import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app/bootstrap';
import type { ActRequest } from '../app/claim-service';
import type { CompiledWorkflow } from '../engine/load';
import { toMermaid } from '../engine/mermaid';
import { HttpProblem, toProblem } from './problem';

export interface ServerOptions {
  /** One line per request (method, path, status, duration); never bodies, which hold PII. */
  log?: (line: string) => void;
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
function actor(request: FastifyRequest): { userId: string; role?: string } {
  const userId = request.headers['x-user-id'];
  if (typeof userId !== 'string' || userId === '') {
    throw new HttpProblem(
      401,
      'AUTHENTICATION_REQUIRED',
      'Name the acting user in the X-User-Id header',
    );
  }
  const role = request.headers['x-role'];
  return { userId, ...(typeof role === 'string' && role !== '' ? { role } : {}) };
}

function idempotencyKey(request: FastifyRequest, body: { idempotency_key?: string | undefined }) {
  const header = request.headers['idempotency-key'];
  return typeof header === 'string' && header !== '' ? header : body.idempotency_key;
}

/** What the UI needs to render forms and labels without knowing the workflow. */
export function describeWorkflow(wf: CompiledWorkflow) {
  const d = wf.definition;
  const withValues = (inputs: CompiledWorkflow['creation']['inputs']) =>
    Object.entries(inputs).map(([name, def]) => ({
      name,
      ...def,
      ...(def.type === 'enum' ? { values: wf.enums[def.enum ?? ''] ?? [] } : {}),
    }));
  return {
    id: wf.id,
    version: wf.version,
    label: d.workflow.label ?? wf.id,
    config_hash: wf.hash,
    states: Object.entries(d.states).map(([name, s]) => ({ name, ...s })),
    roles: Object.entries(d.roles).map(([name, r]) => ({ name, ...r })),
    counters: Object.entries(d.counters).map(([name, c]) => ({ name, max: c.max })),
    document_requirements: d.document_requirements,
    creation: {
      id: wf.creation.id,
      label: wf.creation.label ?? wf.creation.id,
      roles: wf.creation.roles,
      inputs: withValues(wf.creation.inputs),
    },
    transitions: [...wf.transitions.values()].map((t) => ({
      id: t.id,
      label: t.label ?? t.id,
      kind: t.kind,
      from: t.from,
      to: t.to ?? null,
      roles: t.roles,
      automatic: t.automatic,
    })),
    diagram: toMermaid(wf),
  };
}

export async function buildServer(
  app: AppContext,
  options: ServerOptions = {},
): Promise<FastifyInstance> {
  const { service, ops } = app;
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

  const act = async (request: FastifyRequest, claim: string | null, transition: string) => {
    const who = actor(request);
    const body = parseBody(ActBody, request.body);
    const key = idempotencyKey(request, body);
    const req: ActRequest = {
      claim,
      transition_id: transition,
      user_id: who.userId,
      input: body.input ?? {},
      ...(who.role ? { role: who.role } : {}),
      ...(body.expected_version !== undefined ? { expected_version: body.expected_version } : {}),
      ...(key ? { idempotency_key: key } : {}),
    };
    return service.act(req);
  };

  server.get('/api/health', async () => ({
    ok: true,
    workflow: {
      id: service.workflow.id,
      version: service.workflow.version,
      config_hash: service.workflow.hash,
    },
  }));

  server.get('/api/workflow', async () => describeWorkflow(service.workflow));

  server.get('/api/users', async () => (await service.users()).filter((u) => !u.service_account));

  server.get('/api/policies', async () => ops.policies());

  server.get<{ Querystring: { state?: string; queue?: string; limit?: string } }>(
    '/api/claims',
    async (request) => {
      const { state, queue, limit } = request.query;
      const claims = await service.listClaims({
        limit: Math.min(Number(limit) || 100, 500),
        ...(state ? { states: state.split(',') } : {}),
      });
      if (queue !== '1' && queue !== 'true') return claims;
      const who = actor(request);
      const queued = [];
      for (const claim of claims) {
        const { transitions } = await service.available(claim.id, who.userId, who.role);
        const ready = transitions.filter((t) => t.allowed && !t.automatic).map((t) => t.id);
        if (ready.length) queued.push({ ...claim, can_run: ready });
      }
      return queued;
    },
  );

  server.post('/api/claims', async (request, reply) => {
    const result = await act(request, null, service.workflow.creation.id);
    reply.status(result.replayed ? 200 : 201);
    return result;
  });

  server.get<{ Params: { ref: string } }>('/api/claims/:ref', async (request) => {
    const claim = await service.requireClaim(request.params.ref);
    const wf = await service.workflowFor(app.pool, claim);
    const { entries } = await service.audit(claim.id);
    const who = request.headers['x-user-id'] ? actor(request) : undefined;
    const available = who ? await service.available(claim.id, who.userId, who.role) : undefined;
    return {
      claim,
      policy: await ops.policy(claim.policy_id),
      workflow: describeWorkflow(wf),
      diagram: toMermaid(wf, { current: claim.state, visited: entries.map((e) => e.to_state) }),
      ...(available
        ? {
            acting: { user_id: who?.userId, roles: available.roles },
            available: available.transitions,
          }
        : {}),
    };
  });

  server.post<{ Params: { ref: string; transition: string } }>(
    '/api/claims/:ref/transitions/:transition',
    async (request) => act(request, request.params.ref, request.params.transition),
  );

  server.get<{ Params: { ref: string } }>('/api/claims/:ref/audit', async (request) => {
    return (await service.audit(request.params.ref)).entries;
  });

  server.get<{ Params: { ref: string } }>('/api/claims/:ref/denied', async (request) =>
    service.denied(request.params.ref),
  );

  server.get<{ Params: { ref: string } }>('/api/claims/:ref/verify', async (request) =>
    service.verify(request.params.ref),
  );

  server.get<{ Params: { ref: string } }>('/api/claims/:ref/notifications', async (request) => {
    const claim = await service.requireClaim(request.params.ref);
    return ops.notifications(claim.id);
  });

  server.get<{ Params: { ref: string } }>('/api/claims/:ref/outbox', async (request) => {
    const claim = await service.requireClaim(request.params.ref);
    return ops.outbox({ claimId: claim.id });
  });

  /** Fires time-based automatic transitions now (what a scheduler would do periodically). */
  server.post('/api/system/run', async () => ({ results: await service.runSystem() }));

  return server;
}
