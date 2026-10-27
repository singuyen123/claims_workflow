# How this was built with an AI coding assistant

The challenge asks how the problem was decomposed and how the AI tool was directed. This is the
record: the prompts, the review rounds that changed the plan, the guardrails, and the problems
caught along the way.

**Tools.** Claude Code (Claude Opus 5.5) in VS Code on Windows. The developer gave the
requirements, made every product and scope decision, reviewed the plan, installed PostgreSQL and
provided credentials. The assistant researched, planned, wrote the code, tests and docs, and ran
the checks.

## 1. Research and plan, with questions instead of guesses

The first prompt (Vietnamese, translated):

> Research the insurance industry's real process, then analyse it, make a detailed plan of what
> needs to be done, choose the tech stack, point out anything that needs attention, and propose
> what you think would be good for the system, operations and user experience… If anything is
> unclear, ask — don't guess.

The assistant read the challenge, researched Vietnamese reimbursement practice and law (summary in
[domain-research.md](domain-research.md)), and asked before deciding:

| Question | Developer's answer |
|---|---|
| Language and stack | TypeScript / Node.js |
| Interface | CLI plus a compact web UI |
| Business rules beyond the challenge | only the assigned assessor may act; segregation of duties and maker-checker (four-eyes) |
| Technical extras | hash-chained audit trail; transactional outbox with idempotency |

Remaining-limit checks, SLA timers and a KPI report were offered and declined; they are listed as
future work.

## 2. Two review rounds on the plan

The plan was written in plan mode and **reviewed before any code was written**. The developer sent
it back with these change requests (paraphrased from the original Vietnamese):

1. Fold commands into transitions, declaring `inputs` and notification `templates` in the config,
   so the "config only" demo really holds.
2. Call transitions by id; use **named** loop counters.
3. Statically check every path in the DSL; store the config hash in the database.
4. Transaction semantics: lock before reading (`BEGIN IMMEDIATE`), write the idempotency record
   in the same transaction, claim outbox messages atomically, keep the mock gateway's state in
   the database.
5. Store `changes` and a `snapshot_hash` in each audit entry and make verification compare the
   claim row with the last entry ("the most important integrity point still missing").
6. Keep counters and participants on the claim, never read audit history when evaluating, and
   limit how many `*_DENIED` rows can be written.
7. Foreign keys, strict types, CHECKs, generated columns and an explicit index list in the
   migration.
8. Snapshot the reference data and the config hash into every decision.
9. Outbox dispatch must not block the CLI; the scenario runner runs in one process.
10. Use PostgreSQL instead of SQLite.

A second round of questions settled the details: PostgreSQL installed natively, refused attempts
in a separate table de-duplicated per minute, claims pinned to their definition's hash, and full
scope kept (estimated at about 12.5 hours rather than the challenge's 5–8).

Each request maps to a part of the design: (1) and (2) are the transition model; (3) is the
validator and `workflow_definitions`; (4) is `ClaimService.act()` and the outbox; (5) and (8) are
the audit entry and `verify`; (6) is the claim snapshot and `denied_attempts`; (7) is
the schema migration (first `001_init.sql`, now the TypeORM `Init` migration); (9) is the worker and the scenario runner. On PostgreSQL, "lock before reading"
became `SELECT … FOR UPDATE` plus an advisory lock on the idempotency key.

## 3. Guardrails while implementing

- **A written plan, followed phase by phase**: DSL and validator → pure engine → PostgreSQL →
  outbox and verify → CLI → scenarios and the config-only extension → API and web → docs. Each
  phase ended with commits.
- **[CLAUDE.md](../CLAUDE.md)**, written in the first phase, holds the rules the assistant must
  keep across sessions (the context was compacted several times):
  - dependency direction, and a pure engine;
  - no workflow names in TypeScript outside tests and scenario scripts;
  - every config path type-checked;
  - append-only migrations, snake_case data, integer VND, clock-generated millisecond timestamps.
- **Verification after every change**: `tsc` for both projects, Biome, and the test suite. A bug
  found by reasoning or by a test got a test of its own.
- **One commit for the extension**: the appeal workflow (v2) was committed alone, so
  `git show --stat` proves it touched only YAML.
- **Missing information is asked for, not invented**: the assistant did not guess the database
  password; the database-backed code was written first and run once the developer had filled in
  `.env`.

## 4. Problems caught along the way

| Problem | How it was found | Fix |
|---|---|---|
| An unquoted YAML description containing a comma was read as a new key | config load error during the first validation | quoted descriptions |
| A missing approved amount produced follow-on errors ("(not set) exceeds the limit") next to the real one | unit test on approving an incomplete assessment | preconditions that depend on a value already reported missing are skipped, in both the real run and the dry run |
| An outbox message whose worker died during its last attempt would stay `PROCESSING` forever | reasoning about lease expiry | a reaper marks it `DEAD` |
| `drain()` could move the simulated clock backwards when another worker had just leased a due message | writing the two-worker test | only move the clock forward |
| The worker added an abort listener on every idle wait (leak), and a NOTIFY arriving mid-batch waited for the next poll | reviewing the worker while writing the NOTIFY test | one listener; a pending flag re-runs the loop |
| A typo in a shared rule was reported once per transition using it, with two "did you mean" hints | trying the CLI on a broken config | one issue per rule listing its users; one suggestion |
| Trigger functions resolved tables through the caller's `search_path`, unsafe with one schema per test file | review of the migration before its first run | `SET search_path FROM CURRENT` on the functions that read tables |
| Biome treated `useExtension()` as a React hook | lint | renamed to `switchToExtension()` |

## 5. What the assistant was not trusted with

- **Domain facts**: legal deadlines and thresholds are cited with sources, and placeholders are
  marked *to confirm* instead of presented as facts.
- **Credentials and pushing**: `.env` stays out of git, secrets are never printed, and the
  repository is pushed only on the developer's instruction.
- **Scope**: extra features were proposed, and only the ones the developer chose were built.
