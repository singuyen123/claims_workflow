import { describe, expect, it } from 'vitest';
import type { ClaimFilter, ClaimSnapshot, Policy, User } from '../../src/domain/types';
import type { ClaimRepository } from '../../src/repositories/claim-repository';
import type { UserRepository } from '../../src/repositories/reference-repository';
import { ReadAccess } from '../../src/services/access';
import { eachClaim } from '../../src/services/claim-pages';

const users: User[] = [
  { id: 'staff', display_name: 'S', roles: ['assessor'], member_id: null, service_account: false },
  {
    id: 'holder',
    display_name: 'H',
    roles: ['member'],
    member_id: 'MEM-1',
    service_account: false,
  },
];
const userRepo: UserRepository = {
  list: async () => users,
  find: async (id) => users.find((u) => u.id === id) ?? null,
};
const claimOf = (member_id: string) => ({ member_id }) as ClaimSnapshot;

describe('read access', () => {
  const access = new ReadAccess(userRepo);

  it('lets policyholders see their own claims only, as if others did not exist', async () => {
    await expect(access.checkClaim({ user_id: 'holder' }, claimOf('MEM-1'), 'C1')).resolves.toBe(
      undefined,
    );
    await expect(
      access.checkClaim({ user_id: 'holder' }, claimOf('MEM-2'), 'C2'),
    ).rejects.toMatchObject({ code: 'CLAIM_NOT_FOUND' });
    await expect(access.checkClaim({ user_id: 'staff' }, claimOf('MEM-2'), 'C2')).resolves.toBe(
      undefined,
    );
  });

  it('keeps operator data for staff, and refuses unknown viewers', async () => {
    await expect(access.checkStaff({ user_id: 'staff' }, 'The outbox')).resolves.toBe(undefined);
    await expect(access.checkStaff({ user_id: 'holder' }, 'The outbox')).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
    });
    await expect(access.checkStaff({ user_id: 'nobody' }, 'The outbox')).rejects.toMatchObject({
      code: 'UNKNOWN_USER',
    });
  });

  it('filters policies to the policyholder', async () => {
    const policies = [
      { id: 'P1', member_id: 'MEM-1' },
      { id: 'P2', member_id: 'MEM-2' },
    ] as Policy[];
    expect((await access.filterPolicies({ user_id: 'holder' }, policies)).map((p) => p.id)).toEqual(
      ['P1'],
    );
    expect(await access.filterPolicies({ user_id: 'staff' }, policies)).toHaveLength(2);
  });
});

describe('claim pages', () => {
  it('reads every claim, page after page, newest first', async () => {
    const all = Array.from({ length: 7 }, (_, i) => ({
      claim_no: `CLM-2026-${String(i + 1).padStart(6, '0')}`,
      created_at: '2026-10-20T03:00:00.000Z',
    })) as ClaimSnapshot[];
    const newestFirst = [...all].reverse();
    const pages: ClaimFilter[] = [];
    const repo = {
      list: async (filter: ClaimFilter = {}) => {
        pages.push(filter);
        const start = filter.after
          ? newestFirst.findIndex((c) => c.claim_no === filter.after?.claim_no) + 1
          : 0;
        return newestFirst.slice(start, start + (filter.limit ?? 200));
      },
    } as ClaimRepository;
    const seen: string[] = [];
    for await (const claim of eachClaim(repo, { states: ['A'] }, 3)) seen.push(claim.claim_no);
    expect(seen).toEqual(newestFirst.map((c) => c.claim_no));
    expect(pages.map((p) => p.after?.claim_no)).toEqual([
      undefined,
      'CLM-2026-000005',
      'CLM-2026-000002',
    ]);
    expect(pages.every((p) => p.states?.[0] === 'A' && p.limit === 3)).toBe(true);
  });
});
