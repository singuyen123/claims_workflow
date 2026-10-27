import type { ClaimSnapshot, Policy, User } from '../domain/types';
import { WorkflowError } from '../engine/errors';
import type { UserRepository } from '../repositories/reference-repository';

/** The user a read is made for. */
export interface Viewer {
  user_id: string;
}

/**
 * Who may read what. It rests on the one link every deployment has, `users.member_id`, not on
 * workflow roles: a user linked to a member is a policyholder and sees that member's claims and
 * policies only; a user without one is staff and sees everything, operator data included
 * (outbox, refused attempts, the scheduler). A call without a viewer comes from a local operator
 * tool (the CLI), which holds the database credentials anyway.
 */
export class ReadAccess {
  constructor(private readonly users: UserRepository) {}

  /** The viewing user; an id that names nobody is refused. */
  async resolve(viewer: Viewer | undefined): Promise<User | undefined> {
    if (!viewer) return undefined;
    const user = await this.users.find(viewer.user_id);
    if (!user) throw new WorkflowError('UNKNOWN_USER', `Unknown user '${viewer.user_id}'`);
    return user;
  }

  /** The member whose data alone the viewer may see, or undefined for staff and operators. */
  async memberScope(viewer: Viewer | undefined): Promise<string | undefined> {
    return memberOf(await this.resolve(viewer));
  }

  /** Refuses a claim the viewer may not see as if it did not exist. */
  async checkClaim(viewer: Viewer | undefined, claim: ClaimSnapshot, ref: string): Promise<void> {
    const member = await this.memberScope(viewer);
    if (member !== undefined && claim.member_id !== member) {
      throw new WorkflowError('CLAIM_NOT_FOUND', `Claim ${ref} not found`, { claim_no: ref });
    }
  }

  /** Operator data: staff only. */
  async checkStaff(viewer: Viewer | undefined, what: string): Promise<void> {
    const user = await this.resolve(viewer);
    if (memberOf(user) !== undefined) {
      throw new WorkflowError('ACCESS_DENIED', `${what} is visible to staff only`);
    }
  }

  async filterPolicies(viewer: Viewer | undefined, policies: Policy[]): Promise<Policy[]> {
    const member = await this.memberScope(viewer);
    return member === undefined ? policies : policies.filter((p) => p.member_id === member);
  }
}

function memberOf(user: User | undefined): string | undefined {
  return user?.member_id ?? undefined;
}
