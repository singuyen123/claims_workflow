import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/controllers/http/routes';
import type { Services } from '../../src/services/index';

/** Every service call the routes made, with its arguments. */
let calls: Array<[string, ...unknown[]]> = [];

const stub =
  (name: string, result: unknown = {}) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return result;
  };

const services = {
  claims: { create: stub('create', { replayed: false }), act: stub('act') },
  queries: {
    listClaims: stub('listClaims', []),
    detail: stub('detail'),
    auditEntries: stub('auditEntries', []),
  },
  workflows: {},
  operations: {},
} as unknown as Services;

describe('HTTP request models', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer(services);
  });
  afterAll(async () => {
    await server?.close();
  });
  beforeEach(() => {
    calls = [];
  });

  const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
    server.inject({
      method: 'POST',
      url,
      headers: { 'x-user-id': 'u_member_01', ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  it('maps headers and body of a new claim to the service request', async () => {
    const res = await post(
      '/api/claims',
      { input: { policy_id: 'POL-001' }, expected_version: 1, idempotency_key: 'from-the-body' },
      { 'x-role': 'member', 'idempotency-key': 'from-the-header' },
    );
    expect(res.statusCode).toBe(201);
    expect(calls).toEqual([
      [
        'create',
        {
          user_id: 'u_member_01',
          role: 'member',
          input: { policy_id: 'POL-001' },
          expected_version: 1,
          idempotency_key: 'from-the-header',
        },
      ],
    ]);
  });

  it('treats a missing body, null and empty values as absent', async () => {
    await post('/api/claims', undefined, { 'x-role': '' });
    await post('/api/claims', { input: null, expected_version: null, idempotency_key: 'k-body-1' });
    expect(calls).toEqual([
      ['create', { user_id: 'u_member_01', input: {} }],
      ['create', { user_id: 'u_member_01', input: {}, idempotency_key: 'k-body-1' }],
    ]);
  });

  it('takes the claim and the transition from the path', async () => {
    const res = await post('/api/claims/CLM-1/transitions/approve', { input: { amount: 5 } });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([
      [
        'act',
        { user_id: 'u_member_01', input: { amount: 5 }, claim: 'CLM-1', transition_id: 'approve' },
      ],
    ]);
  });

  it('keeps every key of the input as sent', async () => {
    const input = { constructor: 'x', toString: 'a', nested: { valueOf: 1, hasOwnProperty: [2] } };
    const res = await post('/api/claims', { input });
    expect(res.statusCode).toBe(201);
    expect(calls).toEqual([['create', { user_id: 'u_member_01', input }]]);
  });

  it('reads only the named headers', async () => {
    await post(
      '/api/claims',
      {},
      { user_id: 'mallory', role: 'admin', idempotency_key: 'forged-key-1' },
    );
    expect(calls).toEqual([['create', { user_id: 'u_member_01', input: {} }]]);
  });

  it.each([
    [{ constructor: 1 }, 'property constructor should not exist'],
    [{ hasOwnProperty: 1 }, 'property hasOwnProperty should not exist'],
    [{ isPrototypeOf: 1 }, 'property isPrototypeOf should not exist'],
    [{ input: 'x' }, 'input must be an object'],
    [{ input: [] }, 'input must be an object'],
    [{ expected_version: 0 }, 'expected_version must not be less than 1'],
    [{ expected_version: 1.5 }, 'expected_version must be an integer number'],
    [{ idempotency_key: 7 }, 'idempotency_key must be a string'],
    [{ inputs: {} }, 'property inputs should not exist'],
    [[1], 'expected a JSON object'],
  ])('refuses the body %j', async (payload, detail) => {
    const res = await post('/api/claims', payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'BAD_REQUEST' });
    expect(res.json().detail).toContain(detail);
    expect(calls).toEqual([]);
  });

  it('requires the acting user before looking at the body', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/claims', payload: { x: 1 } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      detail: 'Invalid request headers: X-User-Id must name the acting user',
    });
  });

  const get = (url: string, headers: Record<string, string> = { 'x-user-id': 'u_clerk_01' }) =>
    server.inject({ url, headers });

  it('reads the claim list query, for the acting user', async () => {
    await get('/api/claims');
    await get('/api/claims?state=A,B&limit=20&other=ignored');
    await get('/api/claims?state=A&state=B');
    await get('/api/claims?queue=&limit=');
    await get('/api/claims?queue=1&state=', {
      'x-user-id': 'u_clerk_01',
      'x-role': 'document_clerk',
    });
    const viewer = { user_id: 'u_clerk_01' };
    expect(calls).toEqual([
      ['listClaims', { limit: 100, viewer }],
      ['listClaims', { limit: 20, viewer, states: ['A', 'B'] }],
      ['listClaims', { limit: 100, viewer, states: ['A', 'B'] }],
      ['listClaims', { limit: 100, viewer }],
      [
        'listClaims',
        { limit: 100, viewer, queue_for: { user_id: 'u_clerk_01', role: 'document_clerk' } },
      ],
    ]);
  });

  it.each([['limit=0'], ['limit=501'], ['limit=ten'], ['limit=0x10'], ['limit=1e2'], ['limit=-5']])(
    'refuses the query %s with one message',
    async (query) => {
      const res = await get(`/api/claims?${query}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().detail).toBe(
        'Invalid request query: limit must be an integer from 1 to 500',
      );
    },
  );

  it.each([
    ['state=A,,B', 'each value in state should not be empty'],
    ['state=A&state=', 'each value in state should not be empty'],
    ['queue=maybe', 'queue must be a boolean string'],
  ])('refuses the query %s', async (query, detail) => {
    const res = await get(`/api/claims?${query}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toMatch(/^Invalid request query: /);
    expect(res.json().detail).toContain(detail);
  });

  it.each([
    ['GET', '/api/claims'],
    ['GET', '/api/policies'],
    ['GET', '/api/claims/CLM-2'],
    ['GET', '/api/claims/CLM-2/audit'],
    ['GET', '/api/claims/CLM-2/denied'],
    ['GET', '/api/claims/CLM-2/verify'],
    ['GET', '/api/claims/CLM-2/notifications'],
    ['GET', '/api/claims/CLM-2/outbox'],
    ['POST', '/api/system/run'],
  ] as const)('needs the acting user for %s %s', async (method, url) => {
    const res = await server.inject({ method, url });
    expect(res.statusCode).toBe(401);
    expect(calls).toEqual([]);
  });

  it('passes the acting user to every claim read', async () => {
    await get('/api/claims/CLM-2');
    await get('/api/claims/CLM-2/audit');
    const viewer = { user_id: 'u_clerk_01' };
    expect(calls).toEqual([
      ['detail', 'CLM-2', viewer],
      ['auditEntries', 'CLM-2', {}, viewer],
    ]);
  });
});
