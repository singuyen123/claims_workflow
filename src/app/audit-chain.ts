import type { AuditEntry } from '../domain/types';
import type { TransitionPlan } from '../engine/engine';
import { canonicalJson, hmacSha256Hex } from '../engine/hash';

export const GENESIS = 'GENESIS';

export type AuditEntryDraft = Omit<AuditEntry, 'hash'>;

/** The exact fields covered by an entry's HMAC. Listed explicitly so DB-only columns never leak in. */
export function hashedFields(e: AuditEntryDraft): Record<string, unknown> {
  return {
    entry_id: e.entry_id,
    claim_id: e.claim_id,
    claim_seq: e.claim_seq,
    transition_id: e.transition_id,
    from_state: e.from_state,
    to_state: e.to_state,
    actor_user_id: e.actor_user_id,
    actor_role: e.actor_role,
    reason: e.reason,
    notes: e.notes,
    input: e.input,
    changes: e.changes,
    decision_context: e.decision_context,
    effects: e.effects,
    config_hash: e.config_hash,
    claim_version: e.claim_version,
    snapshot_hash: e.snapshot_hash,
    prev_hash: e.prev_hash,
    occurred_at: e.occurred_at,
  };
}

export function computeEntryHash(key: string, e: AuditEntryDraft): string {
  return hmacSha256Hex(key, canonicalJson(hashedFields(e)));
}

/** Turns an engine plan into the next link of the claim's chain. */
export function buildAuditEntry(
  plan: TransitionPlan,
  head: { claim_seq: number; hash: string } | null,
  key: string,
): AuditEntry {
  const draft: AuditEntryDraft = {
    entry_id: plan.entry_id,
    claim_id: plan.after.id,
    claim_seq: (head?.claim_seq ?? 0) + 1,
    transition_id: plan.transition_id,
    from_state: plan.from_state,
    to_state: plan.to_state,
    actor_user_id: plan.decision_context.actor.user_id,
    actor_role: plan.decision_context.actor.role,
    reason: plan.reason,
    notes: plan.notes,
    input: plan.input,
    changes: plan.changes,
    decision_context: plan.decision_context as unknown as Record<string, unknown>,
    effects: plan.effects,
    config_hash: plan.decision_context.config_hash,
    claim_version: plan.after.version,
    snapshot_hash: plan.snapshot_hash,
    prev_hash: head?.hash ?? GENESIS,
    occurred_at: plan.occurred_at,
  };
  return { ...draft, hash: computeEntryHash(key, draft) };
}
