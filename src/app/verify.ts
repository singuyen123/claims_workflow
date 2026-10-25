import jsonpatch from 'fast-json-patch';
import type { AuditEntry, ClaimSnapshot, JsonPatchOp } from '../domain/types';
import { hashValue } from '../engine/hash';
import { computeEntryHash, GENESIS } from './audit-chain';

export type VerifyIssueCode =
  | 'NO_ENTRIES'
  | 'SEQUENCE_GAP'
  | 'CHAIN_BROKEN'
  | 'ENTRY_TAMPERED'
  | 'REPLAY_FAILED'
  | 'REPLAY_MISMATCH'
  | 'CLAIM_ROW_TAMPERED'
  | 'DEFINITION_TAMPERED';

export interface VerifyIssue {
  code: VerifyIssueCode;
  message: string;
  claim_seq?: number;
  /** For CLAIM_ROW_TAMPERED: patch from the last audited snapshot to the current row. */
  diff?: JsonPatchOp[];
}

export interface VerifyReport {
  claim_id: string;
  claim_no: string;
  ok: boolean;
  entries: number;
  head_hash: string | null;
  issues: VerifyIssue[];
}

type PatchOps = Parameters<typeof jsonpatch.applyPatch>[1];

/**
 * Checks a claim's audit trail end to end:
 * 1. sequence numbers are contiguous and each entry links to the previous hash;
 * 2. each entry's HMAC matches its content;
 * 3. replaying `changes` from an empty document reproduces every `snapshot_hash`;
 * 4. the current claim row equals the last audited snapshot.
 */
export function verifyClaimChain(
  claim: ClaimSnapshot,
  entries: AuditEntry[],
  key: string,
): VerifyReport {
  const issues: VerifyIssue[] = [];
  if (entries.length === 0) {
    issues.push({ code: 'NO_ENTRIES', message: `Claim ${claim.claim_no} has no audit entries` });
  }
  let previousHash = GENESIS;
  let replayed: Record<string, unknown> = {};
  let replayOk = true;

  entries.forEach((entry, index) => {
    const seq = index + 1;
    if (entry.claim_seq !== seq) {
      issues.push({
        code: 'SEQUENCE_GAP',
        claim_seq: entry.claim_seq,
        message: `Expected entry #${seq}, found #${entry.claim_seq}: an entry is missing`,
      });
    }
    if (entry.prev_hash !== previousHash) {
      issues.push({
        code: 'CHAIN_BROKEN',
        claim_seq: entry.claim_seq,
        message: `Entry #${entry.claim_seq} does not link to the previous entry's hash`,
      });
    }
    const { hash, ...draft } = entry;
    if (computeEntryHash(key, draft) !== hash) {
      issues.push({
        code: 'ENTRY_TAMPERED',
        claim_seq: entry.claim_seq,
        message: `Entry #${entry.claim_seq} (${entry.transition_id}) was modified: its HMAC does not match its content`,
      });
    }
    if (replayOk) {
      try {
        replayed = jsonpatch.applyPatch(
          structuredClone(replayed),
          entry.changes as PatchOps,
          true,
          false,
        ).newDocument as Record<string, unknown>;
        if (hashValue(replayed) !== entry.snapshot_hash) {
          issues.push({
            code: 'REPLAY_MISMATCH',
            claim_seq: entry.claim_seq,
            message: `Replaying changes up to entry #${entry.claim_seq} does not reproduce its snapshot hash`,
          });
        }
      } catch (error) {
        replayOk = false;
        issues.push({
          code: 'REPLAY_FAILED',
          claim_seq: entry.claim_seq,
          message: `Changes of entry #${entry.claim_seq} cannot be applied: ${(error as Error).message}`,
        });
      }
    }
    previousHash = entry.hash;
  });

  const last = entries.at(-1);
  if (last) {
    const current = claim as unknown as Record<string, unknown>;
    if (hashValue(current) !== last.snapshot_hash || claim.version !== last.claim_version) {
      const diff = replayOk ? (jsonpatch.compare(replayed, current) as JsonPatchOp[]) : undefined;
      const fields = diff?.map((op) => op.path).join(', ');
      issues.push({
        code: 'CLAIM_ROW_TAMPERED',
        message: `The claim row differs from the last audited snapshot (entry #${last.claim_seq})${fields ? `: ${fields}` : ''}`,
        ...(diff ? { diff } : {}),
      });
    }
  }

  return {
    claim_id: claim.id,
    claim_no: claim.claim_no,
    ok: issues.length === 0,
    entries: entries.length,
    head_hash: last?.hash ?? null,
    issues,
  };
}
