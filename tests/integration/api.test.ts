import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/controllers/http/routes';
import { createTestDb, hasDatabase, type TestDb } from '../helpers/pg-schema';

const as = (user: string, role?: string) => ({
  'x-user-id': user,
  ...(role ? { 'x-role': role } : {}),
});

const NEW_CLAIM = {
  input: {
    policy_id: 'POL-001',
    claim_type: 'outpatient',
    claimed_amount: 1_000_000,
    treatment_date: '2026-10-15',
  },
};

describe.skipIf(!hasDatabase)('HTTP API', () => {
  let db: TestDb;
  let server: FastifyInstance;

  beforeAll(async () => {
    db = await createTestDb('api');
    server = await buildServer(db.app.services);
  });
  afterAll(async () => {
    await server?.close();
    await db?.close();
  });

  const submit = async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/claims',
      headers: as('u_member_01'),
      payload: NEW_CLAIM,
    });
    expect(res.statusCode).toBe(201);
    return res.json().claim.claim_no as string;
  };

  it('creates a claim, runs transitions by id and lists what the user can do', async () => {
    const claimNo = await submit();
    const attach = await server.inject({
      method: 'POST',
      url: `/api/claims/${claimNo}/transitions/attach_document`,
      headers: as('u_member_01'),
      payload: { input: { document_type: 'claim_form' } },
    });
    expect(attach.statusCode).toBe(200);
    expect(attach.json().entry).toMatchObject({
      transition_id: 'attach_document',
      actor_role: 'member',
    });

    const detail = (
      await server.inject({ url: `/api/claims/${claimNo}`, headers: as('u_clerk_01') })
    ).json();
    expect(detail.claim.state).toBe('SUBMITTED');
    expect(detail.diagram).toContain('class SUBMITTED current');
    const verify = detail.available.find((t: { id: string }) => t.id === 'verify_documents');
    expect(verify).toMatchObject({ allowed: false, roles: ['document_clerk'] });
  });

  it('answers refusals with RFC 9457 problem details', async () => {
    const claimNo = await submit();
    const res = await server.inject({
      method: 'POST',
      url: `/api/claims/${claimNo}/transitions/approve`,
      headers: as('u_assessor_01'),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({
      type: 'urn:claims-workflow:problem:invalid-transition',
      title: 'Invalid transition',
      status: 409,
      code: 'INVALID_TRANSITION',
      path_to_target: ['verify_documents', 'start_assessment', 'approve'],
    });
    expect(res.json().detail).toContain('is SUBMITTED');

    const role = await server.inject({
      method: 'POST',
      url: `/api/claims/${claimNo}/transitions/verify_documents`,
      headers: as('u_finance_01'),
      payload: {},
    });
    expect([role.statusCode, role.json().code]).toEqual([403, 'UNAUTHORIZED_ROLE']);
  });

  it('requires the acting user and a well-formed body', async () => {
    const anonymous = await server.inject({
      method: 'POST',
      url: '/api/claims',
      payload: NEW_CLAIM,
    });
    expect([anonymous.statusCode, anonymous.json().code]).toEqual([401, 'AUTHENTICATION_REQUIRED']);

    const badShape = await server.inject({
      method: 'POST',
      url: '/api/claims',
      headers: as('u_member_01'),
      payload: { input: 'x' },
    });
    expect([badShape.statusCode, badShape.json().code]).toEqual([400, 'BAD_REQUEST']);

    const badJson = await server.inject({
      method: 'POST',
      url: '/api/claims',
      headers: { ...as('u_member_01'), 'content-type': 'application/json' },
      payload: '{"input":',
    });
    expect([badJson.statusCode, badJson.json().code]).toEqual([400, 'BAD_REQUEST']);

    const unknown = await server.inject({ url: '/api/nothing-here' });
    expect([unknown.statusCode, unknown.json().code]).toEqual([404, 'NOT_FOUND']);
  });

  it('replays a request sent again with the same Idempotency-Key header', async () => {
    const headers = { ...as('u_member_01'), 'idempotency-key': 'api-create-0001' };
    const first = await server.inject({
      method: 'POST',
      url: '/api/claims',
      headers,
      payload: NEW_CLAIM,
    });
    const again = await server.inject({
      method: 'POST',
      url: '/api/claims',
      headers,
      payload: NEW_CLAIM,
    });
    expect([first.statusCode, again.statusCode]).toEqual([201, 200]);
    expect(again.json()).toMatchObject({
      replayed: true,
      entry: { entry_id: first.json().entry.entry_id },
    });
  });

  it('serves the audit trail, refused attempts and the integrity check of a claim', async () => {
    const claimNo = await submit();
    await server.inject({
      method: 'POST',
      url: `/api/claims/${claimNo}/transitions/approve`,
      headers: as('u_assessor_01'),
      payload: {},
    });
    const read = (url: string, user = 'u_assessor_01') => server.inject({ url, headers: as(user) });
    const audit = (await read(`/api/claims/${claimNo}/audit`)).json();
    expect(audit.map((e: { transition_id: string }) => e.transition_id)).toEqual(['submit_claim']);
    const denied = (await read(`/api/claims/${claimNo}/denied`)).json();
    expect(denied.map((d: { error_code: string }) => d.error_code)).toEqual(['INVALID_TRANSITION']);
    const verify = (await read(`/api/claims/${claimNo}/verify`)).json();
    expect(verify).toMatchObject({ ok: true, entries: 1 });
  });

  it('shows a policyholder their own claims only, and operator data to staff only', async () => {
    const claimNo = await submit();
    const read = (url: string, user: string) => server.inject({ url, headers: as(user) });

    expect((await read(`/api/claims/${claimNo}`, 'u_member_01')).statusCode).toBe(200);
    expect((await read(`/api/claims/${claimNo}/audit`, 'u_member_02')).statusCode).toBe(404);
    expect((await read(`/api/claims/${claimNo}/verify`, 'u_member_02')).statusCode).toBe(404);
    const theirs = (await read('/api/claims', 'u_member_02')).json();
    expect(theirs.map((c: { claim_no: string }) => c.claim_no)).not.toContain(claimNo);
    const policies = (await read('/api/policies', 'u_member_02')).json();
    expect(new Set(policies.map((p: { member_id: string }) => p.member_id))).toEqual(
      new Set(['MEM-002']),
    );

    expect((await read(`/api/claims/${claimNo}/outbox`, 'u_member_01')).statusCode).toBe(403);
    expect((await read(`/api/claims/${claimNo}/outbox`, 'u_clerk_01')).statusCode).toBe(200);
    const run = await server.inject({
      method: 'POST',
      url: '/api/system/run',
      headers: as('u_member_01'),
    });
    expect(run.statusCode).toBe(403);
  });
});
