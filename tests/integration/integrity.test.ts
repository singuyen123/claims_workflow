import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, Driver, hasDatabase, type TestDb } from '../helpers/pg-schema';

/** Runs statements as the owner with the table's user triggers off: a deliberate tamper. */
async function tamper(owner: pg.Pool, table: string, sql: string, params: unknown[] = []) {
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await client.query(sql, params);
    await client.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe.skipIf(!hasDatabase)('database guarantees', () => {
  let db: TestDb;
  let d: Driver;
  let claimNo: string;
  let claimId: string;

  beforeAll(async () => {
    db = await createTestDb('integrity');
    d = new Driver(db);
    claimNo = await d.submit();
    await d.toAssessment(claimNo);
    await d.fail(claimNo, 'approve', 'u_assessor_02'); // row triggers need rows to fire on
    claimId = (await d.service.requireClaim(claimNo)).id;
  });
  afterAll(() => db?.close());

  it('audit entries cannot be updated, deleted or truncated, even by the schema owner', async () => {
    await expect(db.owner.query(`UPDATE audit_log SET reason = 'edited'`)).rejects.toThrow(
      /audit_log is append-only: UPDATE is not allowed/,
    );
    await expect(db.owner.query('DELETE FROM audit_log')).rejects.toThrow(/append-only: DELETE/);
    await expect(db.owner.query('TRUNCATE audit_log CASCADE')).rejects.toThrow(
      /append-only: TRUNCATE/,
    );
    await expect(db.owner.query('DELETE FROM denied_attempts')).rejects.toThrow(/append-only/);
    await expect(db.owner.query('UPDATE workflow_definitions SET version = 9')).rejects.toThrow(
      /append-only/,
    );
  });

  it('the runtime role has no UPDATE or DELETE privilege on the audit trail and claims', async () => {
    const app = db.app.pool;
    await expect(app.query(`UPDATE audit_log SET reason = 'edited'`)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(app.query('DELETE FROM audit_log')).rejects.toMatchObject({ code: '42501' });
    await expect(app.query('DELETE FROM claims')).rejects.toMatchObject({ code: '42501' });
    await expect(app.query('TRUNCATE outbox')).rejects.toMatchObject({ code: '42501' });
    await expect(
      app.query('UPDATE users SET roles = ARRAY[$1]', ['finance']),
    ).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('a claim cannot change without its audit entry: the deferred check fails the commit', async () => {
    const client = await db.app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE claims SET version = version + 1, data = data || '{"assessor_id":"u_assessor_02"}' WHERE id = $1`,
        [claimId],
      );
      await expect(client.query('COMMIT')).rejects.toThrow(/has no audit entry/);
    } finally {
      client.release();
    }
    expect((await d.service.requireClaim(claimId)).data.assessor_id).toBe('u_assessor_01');
  });

  it('versions move one step at a time and identity columns are immutable', async () => {
    await expect(
      db.owner.query('UPDATE claims SET version = version + 2 WHERE id = $1', [claimId]),
    ).rejects.toThrow(/must move from version/);
    await expect(
      db.owner.query('UPDATE claims SET version = version + 1, claimed_amount = 1 WHERE id = $1', [
        claimId,
      ]),
    ).rejects.toThrow(/identity columns cannot change/);
  });

  it('a claim can only be in a state of the definition it is pinned to', async () => {
    await expect(
      db.owner.query(`UPDATE claims SET version = version + 1, state = 'ON_HOLD' WHERE id = $1`, [
        claimId,
      ]),
    ).rejects.toThrow(/state ON_HOLD is not defined in workflow definition/);
  });

  it('CHECK constraints reject malformed rows', async () => {
    const claim = await d.service.requireClaim(claimId);
    await expect(
      db.owner.query(
        `INSERT INTO claims (id, claim_no, config_hash, policy_id, member_id, claim_type, claimed_amount,
                             state, state_entered_at, version, created_at, updated_at)
         VALUES (gen_random_uuid(), 'CLM-2026-999999', $1, 'POL-001', 'MEM-001', 'outpatient', 0,
                 'SUBMITTED', $2, 1, $2, $2)`,
        [claim.config_hash, claim.created_at],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.owner.query(`INSERT INTO policies (id, member_id, product, coverage_limit, effective_from, effective_to)
                      VALUES ('POL-X', 'MEM-X', 'x', 1000, '2026-12-31', '2026-01-01')`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('the generated assessor_id column follows the claim data', async () => {
    const { rows } = await db.owner.query('SELECT assessor_id FROM claims WHERE id = $1', [
      claimId,
    ]);
    expect(rows[0].assessor_id).toBe('u_assessor_01');
    expect(
      (await d.service.listClaims({ assessorId: 'u_assessor_01' })).map((c) => c.id),
    ).toContain(claimId);
  });
});

describe.skipIf(!hasDatabase)('verify detects tampering', () => {
  let db: TestDb;
  let d: Driver;

  beforeAll(async () => {
    db = await createTestDb('tamper');
    d = new Driver(db);
  });
  afterAll(() => db?.close());

  async function freshClaim() {
    const claimNo = await d.submit();
    await d.toAssessment(claimNo);
    await d.assess(claimNo, 2_000_000);
    return d.service.requireClaim(claimNo);
  }

  it('an untouched claim verifies', async () => {
    const claim = await freshClaim();
    const report = await d.service.verify(claim.claim_no);
    expect(report).toMatchObject({ ok: true, issues: [], entries: claim.version });
  });

  it('a claim row edited behind the engine is reported with the changed fields', async () => {
    const claim = await freshClaim();
    await tamper(
      db.owner,
      'claims',
      `UPDATE claims SET data = jsonb_set(data, '{assessment,approved_amount}', '90000000') WHERE id = $1`,
      [claim.id],
    );
    const report = await d.service.verify(claim.claim_no);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'CLAIM_ROW_TAMPERED',
        diff: [{ op: 'replace', path: '/data/assessment/approved_amount', value: 90_000_000 }],
      }),
    ]);
  });

  it('an edited audit entry breaks its HMAC', async () => {
    const claim = await freshClaim();
    await tamper(
      db.owner,
      'audit_log',
      `UPDATE audit_log SET actor_user_id = 'u_lead_01' WHERE claim_id = $1 AND claim_seq = 2`,
      [claim.id],
    );
    const report = await d.service.verify(claim.claim_no);
    expect(report.issues.map((i) => [i.code, i.claim_seq])).toEqual([['ENTRY_TAMPERED', 2]]);
  });

  it('a deleted audit entry breaks the sequence and the chain', async () => {
    const claim = await freshClaim();
    await tamper(
      db.owner,
      'audit_log',
      'DELETE FROM audit_log WHERE claim_id = $1 AND claim_seq = 3',
      [claim.id],
    );
    const codes = (await d.service.verify(claim.claim_no)).issues.map((i) => i.code);
    expect(codes).toContain('SEQUENCE_GAP');
    expect(codes).toContain('CHAIN_BROKEN');
  });

  it('a rewritten change set no longer replays to the recorded snapshot', async () => {
    const claim = await freshClaim();
    await tamper(
      db.owner,
      'audit_log',
      `UPDATE audit_log SET changes = '[]' WHERE claim_id = $1 AND claim_seq = 2`,
      [claim.id],
    );
    const codes = (await d.service.verify(claim.claim_no)).issues.map((i) => i.code);
    expect(codes).toContain('ENTRY_TAMPERED');
    expect(codes).toContain('REPLAY_MISMATCH');
  });

  it('a modified workflow definition is detected (runs last: it taints the shared definition)', async () => {
    const claim = await freshClaim();
    await tamper(
      db.owner,
      'workflow_definitions',
      `UPDATE workflow_definitions
          SET content = jsonb_set(content, '{counters,info_requests,max}', '99')
        WHERE config_hash = $1`,
      [claim.config_hash],
    );
    const report = await d.service.verify(claim.claim_no);
    expect(report.issues.map((i) => i.code)).toEqual(['DEFINITION_TAMPERED']);
  });
});
