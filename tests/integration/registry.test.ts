import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkflowError } from '../../src/engine/errors';
import { ConfigError, loadWorkflowText } from '../../src/engine/load';
import { MINUTE } from '../../src/services/clock';
import {
  BASE_WORKFLOW,
  createTestDb,
  Driver,
  hasDatabase,
  type TestDb,
} from '../helpers/pg-schema';

/** The shipped workflow with text replacements applied (each must match exactly once). */
function variant(source: string, replacements: Array<[string, string]>) {
  let text = readFileSync(BASE_WORKFLOW, 'utf8');
  for (const [from, to] of replacements) {
    if (text.split(from).length !== 2)
      throw new Error(`fixture: '${from}' must occur exactly once`);
    text = text.replace(from, to);
  }
  return loadWorkflowText(text, source);
}

describe.skipIf(!hasDatabase)('workflow versions and pinning', () => {
  let db: TestDb;
  let d: Driver;

  beforeAll(async () => {
    db = await createTestDb('registry');
    d = new Driver(db);
  });
  afterAll(() => db?.close());

  it('changing a workflow without bumping its version is refused at startup', async () => {
    const edited = variant('edited v1', [['value: 50000000', 'value: 40000000']]);
    const error = await db.openApp(edited).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).message).toContain('CONFIG_VERSION_NOT_BUMPED');
  });

  it('claims keep the definition they were created under; new claims use the new version', async () => {
    const oldClaim = await d.submit();
    await d.toAssessment(oldClaim);
    await d.assess(oldClaim, 2_000_000);

    // v2 lowers the single-approver limit from 50,000,000 to 1,000,000 VND.
    const v2 = variant('v2', [
      ['version: 1', 'version: 2'],
      ['value: 50000000', 'value: 1000000'],
    ]);
    const d2 = new Driver(db, await db.openApp(v2));

    const approved = await d2.ok(oldClaim, 'approve', 'u_assessor_01');
    expect(approved.entry.config_hash).toBe(db.app.workflow.hash);

    const newClaim = await d2.submit();
    await d2.toAssessment(newClaim);
    await d2.assess(newClaim, 2_000_000);
    const refused = await d2.fail(newClaim, 'approve', 'u_assessor_01');
    expect(refused.details.failures?.map((f) => f.code)).toEqual(['FOUR_EYES_REQUIRED']);
    expect((await d2.services.queries.requireClaim(newClaim)).config_hash).toBe(v2.hash);

    const versions = (await d2.app.services.workflows.definitions()).map((x) => [
      x.version,
      x.config_hash,
    ]);
    expect(versions).toEqual([
      [1, db.app.workflow.hash],
      [2, v2.hash],
    ]);
    expect((await d2.services.queries.verify(oldClaim)).ok).toBe(true);
    expect((await d2.services.queries.verify(newClaim)).ok).toBe(true);
  });
});

describe.skipIf(!hasDatabase)('refused attempts', () => {
  let db: TestDb;
  let d: Driver;

  beforeAll(async () => {
    db = await createTestDb('denied');
    d = new Driver(db);
  });
  afterAll(() => db?.close());

  const refuse = async (claim: string, transition: string, user: string) => {
    try {
      await d.services.claims.act({ claim, transition_id: transition, user_id: user });
    } catch (error) {
      if (error instanceof WorkflowError) return error;
      throw error;
    }
    throw new Error('expected a refusal');
  };

  it('are recorded apart from the audit chain and leave the claim unchanged', async () => {
    const claimNo = await d.submit();
    const before = await d.services.queries.audit(claimNo);
    await refuse(claimNo, 'approve', 'u_assessor_01');

    const after = await d.services.queries.audit(claimNo);
    expect(after).toEqual(before);
    expect(await d.services.queries.denied(claimNo)).toEqual([
      expect.objectContaining({
        claim_id: before.claim.id,
        transition_id: 'approve',
        actor_user_id: 'u_assessor_01',
        actor_role: 'assessor',
        error_code: 'INVALID_TRANSITION',
      }),
    ]);
    expect((await d.services.queries.verify(claimNo)).ok).toBe(true);
  });

  it('identical refusals within one minute are stored once', async () => {
    const claimNo = await d.submit();
    for (let i = 0; i < 5; i++) await refuse(claimNo, 'verify_documents', 'u_clerk_01');
    expect(await d.services.queries.denied(claimNo)).toHaveLength(1);

    await refuse(claimNo, 'start_assessment', 'u_lead_01');
    expect(await d.services.queries.denied(claimNo)).toHaveLength(2);

    db.clock.advance(MINUTE);
    await refuse(claimNo, 'verify_documents', 'u_clerk_01');
    expect(await d.services.queries.denied(claimNo)).toHaveLength(3);
  });

  it('refusals for unknown claims and users are recorded too', async () => {
    await refuse('CLM-2026-999999', 'approve', 'u_assessor_01');
    await refuse(await d.submit(), 'verify_documents', 'mallory');
    const codes = (await d.services.queries.denied()).map((x) => [x.actor_user_id, x.error_code]);
    expect(codes).toContainEqual(['u_assessor_01', 'CLAIM_NOT_FOUND']);
    expect(codes).toContainEqual(['mallory', 'UNKNOWN_USER']);
  });
});
