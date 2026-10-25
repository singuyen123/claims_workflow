# Design

How the claims workflow orchestrator is built and why. For a quick start see the
[README](../README.md); for adding states and transitions see
[extending-the-workflow.md](extending-the-workflow.md).

## Layers

```mermaid
flowchart LR
  cli[CLI<br/>src/cli] --> app
  api[HTTP API<br/>src/api] --> app
  web[Web UI<br/>web/] -. HTTP .-> api
  scenarios[Scenario runner<br/>src/scenarios] --> app
  app[Application<br/>ClaimService, registry, verify] --> engine[Engine<br/>pure functions]
  app --> infra[Infrastructure<br/>PostgreSQL repos, outbox worker, mocks]
  config[(config/workflow.yaml)] --> engine
```

- **Engine** (`src/engine`): parses and validates the workflow file and evaluates transitions. It
  is pure: no I/O, no clock, no randomness. Time and id generation are passed in. It knows nothing
  about claims beyond a small contract (a claim has a policy, a member, a type, an amount, a state,
  counters and participants).
- **Application** (`src/app`): `ClaimService` runs one transition per database transaction,
  `DefinitionRegistry` stores and pins workflow versions, `verify` checks the audit trail,
  `Operations` exposes the outbox and mocks.
- **Infrastructure** (`src/infra`): SQL migrations and repositories, the outbox worker and its
  handlers, the mock payment gateway and notification channel.
- **Interfaces**: the CLI, the HTTP API and the web UI share the application layer; the scenario
  runner drives it in-process.

Dependencies point one way (interfaces → application → engine), so the engine's unit tests run
without a database.

## The workflow file

Everything specific to health claims is in [`config/workflow.yaml`](../config/workflow.yaml):

| Section | Purpose |
|---|---|
| `workflow` | id, version, initial state |
| `settings` | typed values used by rules: appeal period, four-eyes threshold, filing deadline |
| `roles`, `enums`, `document_requirements` | vocabulary; `system` is service-account-only |
| `fields` | typed schema of the claim's data, against which every path is checked |
| `counters` | named loop limits with their refusal message |
| `rules` | named conditions reused by transitions |
| `templates` | notifications with a recipient and placeholders |
| `states`, `transitions` | the state machine |

**Every action is a transition.** A transition without `from` creates a claim; one with `from`
and `to` changes state; one without `to` is an in-state action such as attaching a document,
assigning an assessor or co-signing. Each declares its `inputs` (typed, with `required`, `min`,
`max_length` …), `roles`, `authorization` (who, on this claim), `increments` (counters),
`preconditions` (whether the claim is ready) and `effects`. Clients call transitions by id; the
CLI's interactive mode and the web UI build their forms from `inputs`.

**Conditions** are a small set of primitives: `compare`, `field_present`, `documents_present`,
`received_since_state_entry`, `duration_elapsed`, `has_role`, `not_performed`, `all_of`, `any_of`,
`not`, and `ref` to a named rule. Each can carry a `code` and a `message` with placeholders, which
become the refusal the user sees.

**Effects** are either internal (`set`, `append`, `clear` on claim fields, applied in the same
transaction) or external (`notify`, `trigger_payment`, `log`, delivered through the outbox).
Values are literals, `$paths`, `$now`, `$uuid` or `{ fn: add, args: [$now, $settings.appeal_period] }`.

### Static checking

The validator (`src/engine/validate.ts`) builds the type of every context a rule can see: the
claim's columns and declared fields, the policy, the actor, `$settings`, counters, participants,
and the inputs of *that* transition. Then it checks the whole file:

- every `$path` and `{placeholder}` resolves, with "did you mean" suggestions;
- compared operands have compatible types (money with money, date with date …), and enum literals
  are values of their enum;
- effects write declared fields with the right type and never touch engine-managed columns;
- referenced roles, states, enums, rules, templates, counters and transitions exist;
- every state is reachable, every non-terminal state has a way out, there is exactly one creation
  transition and automatic transitions belong to service-account roles;
- **every cycle in the state graph passes through a transition that increments a bounded
  counter**, which is what makes "infinite loop" impossible by construction rather than at run time.

A broken file never starts: the CLI, the API and the worker all load through the same validator.

## Evaluating a transition

`evaluateTransition(workflow, claim, request, refs, env)` checks, in this order, and stops at the
first stage that fails:

| # | Check | Error code (HTTP) |
|---|---|---|
| 1 | the transition id exists ("did you mean …") | `UNKNOWN_TRANSITION` (400) |
| 2 | the claim is not in a terminal state | `TERMINAL_STATE` (409) |
| 3 | the claim's state is in `from`; the error lists what *is* available and the shortest path to the target state | `INVALID_TRANSITION` (409) |
| 4 | `expected_version`, when given | `CONCURRENT_MODIFICATION` (409) |
| 5 | the user holds the role and the role may run the transition; service-account roles only for service accounts | `ROLE_NOT_ASSIGNED`, `UNAUTHORIZED_ROLE`, `SERVICE_ACCOUNT_ONLY` (403) |
| 6 | inputs are declared and well-typed | `INVALID_INPUT` (400) |
| 7 | authorization rules on this claim (assigned assessor, claim owner, segregation of duties) | `ACCESS_DENIED` (403) |
| 8 | counters below their max | `CYCLE_LIMIT_EXCEEDED` (422) |
| 9 | preconditions, **all reported together**, including required inputs | `PRECONDITION_FAILED` (422) with one failure per rule |

Preconditions that depend on a value already reported missing are skipped, so one missing
assessment produces "assessment incomplete" instead of three follow-on errors. The engine never
reads the audit history: everything a rule needs (counters, the users who performed each
transition, `state_entered_at`) is kept on the claim.

On success it returns a **plan**: the claim after the transition (state, version, counters,
participants, data), the JSON Patch from the previous snapshot, the SHA-256 of the new snapshot,
a decision context (every value the rules read, every check's outcome, the config hash) and the
rendered outbox messages. `availableTransitions()` runs the same checks as a dry run for the
"what can I do now" checklist.

## One transition, one transaction

```mermaid
sequenceDiagram
  participant C as CLI / API
  participant S as ClaimService
  participant DB as PostgreSQL
  C->>S: act(claim, transition, user, input, key)
  S->>DB: BEGIN
  S->>DB: pg_advisory_xact_lock(key)  (if an idempotency key is given)
  S->>DB: SELECT … FROM claims WHERE … FOR UPDATE
  S->>DB: idempotency_keys lookup → replay the stored result if seen
  S->>S: evaluateTransition() with the claim's pinned definition
  alt refused
    S->>DB: ROLLBACK
    S->>DB: INSERT denied_attempts … ON CONFLICT DO NOTHING
    S-->>C: WorkflowError (code, message, failures)
  else allowed
    S->>DB: UPDATE claims (version + 1) · INSERT audit_log · INSERT outbox · INSERT idempotency_keys
    S->>DB: pg_notify('claims_outbox', schema)
    S->>DB: COMMIT
    S->>S: run automatic transitions that now hold (as svc_system)
    S-->>C: result (claim, audit entry, queued effects)
  end
```

- Locks are always taken in the same order (idempotency key, then claim row) and nothing external
  is called inside the transaction, so transactions stay short and cannot deadlock each other.
  `SELECT … FOR UPDATE` plays the role SQLite's `BEGIN IMMEDIATE` would: concurrent actions on one
  claim run one after the other, and the loser re-evaluates against the new state (usually an
  `INVALID_TRANSITION`).
- The idempotency record is written in the same transaction as the change, so a retried request
  either sees it or performs the change, never both. A key reused with a different request or by
  another user is refused.
- Timestamps come from the injected clock with millisecond precision (PostgreSQL stores
  microseconds, so the values round-trip exactly and the hashes stay stable); a claim's timestamps
  strictly increase.

## Database guarantees

The schema ([`001_init.sql`](../src/infra/db/migrations/001_init.sql)) enforces what the
application promises, so a bug or a manual query cannot silently break it:

- **Append-only tables.** `audit_log`, `denied_attempts` and `workflow_definitions` reject
  UPDATE and DELETE (row triggers) and TRUNCATE (statement trigger), even for the schema owner.
- **No change without an audit entry.** A deferred constraint trigger fails the commit if a claim
  version has no audit entry with the same version.
- **Claims move one version at a time** and their identity columns (policy, member, type, amount,
  pinned definition) never change; the state must exist in the claim's pinned definition.
- **Least privilege.** The application connects as `claims_app`, which can insert but not update
  or delete audit rows, and cannot delete or truncate anything. Migrations run as `claims_owner`.
- Types and CHECKs everywhere: money as `bigint` below 2^53 (exact in JavaScript), JSONB columns
  must be objects or arrays, hash formats, claim number format, outbox status and lease
  consistency. A generated `assessor_id` column and partial indexes serve the work queues.
- Migrations are append-only; the runner stores checksums and refuses an edited migration.

## Tamper evidence

Database rules stop casual edits, but an owner or superuser can disable triggers. The audit trail
is therefore also **verifiable**:

- each entry stores `changes` (JSON Patch), `snapshot_hash` (SHA-256 of the canonical claim
  snapshot after the entry, RFC 8785 JSON), `decision_context` and the config hash;
- entries are chained per claim: `hash = HMAC-SHA256(key, canonical(entry including prev_hash))`,
  starting from `GENESIS`. The key is not in the database.

`claims verify` (and the API and web button) checks that sequence numbers are contiguous and every
entry links to the previous hash, recomputes each HMAC, replays the patches from an empty document
and compares every snapshot hash, compares the **current claim row with the last entry** (and
prints a diff of the fields changed behind the engine's back), and re-hashes the stored workflow
definitions.

| Attack | Result |
|---|---|
| Application bug or SQL as `claims_app` updating/deleting audit rows | prevented (privileges) |
| Owner running `UPDATE audit_log` or `TRUNCATE` | prevented (triggers) |
| Owner changing a claim without an audit entry | prevented (deferred trigger) |
| Owner disabling triggers and editing a claim row | detected: `CLAIM_ROW_TAMPERED` with diff |
| … editing, deleting or rewriting audit entries | detected: `ENTRY_TAMPERED`, `SEQUENCE_GAP`, `CHAIN_BROKEN`, `REPLAY_MISMATCH` |
| … editing a stored workflow definition | detected: `DEFINITION_TAMPERED` |
| Someone with the HMAC key *and* owner rights rewriting a claim's whole history consistently | not detected locally: anchor chain heads outside the database and keep the key in a KMS (future work) |

`npm run demo:tamper` shows each row of this table.

## Versions and pinning

The config hash is the SHA-256 of the normalised file content (not the YAML text), so comments and
formatting do not change it. At startup the current definition is stored in
`workflow_definitions`; if the same `(workflow_id, version)` is already stored with a different
hash, startup fails with `CONFIG_VERSION_NOT_BUMPED`. Each claim stores the hash it was created
under and is always evaluated with that stored definition, re-hashed on load. New claims use the
new version, existing ones finish under the rules they started with. Moving open claims to a new
version would need an explicit migration step; it is out of scope.

## Side effects: transactional outbox

External effects are rows in `outbox`, inserted in the same transaction as the transition, so a
rolled-back transition never sends anything and a committed one is never lost. Delivery is
**at least once**; handlers are idempotent by key, which makes the effect happen once:

- workers lease due messages with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, so
  several workers never take the same message; a lease that expires (crashed worker) is taken
  again;
- failures retry with exponential backoff (1 s, 2 s, 4 s … up to 60 s); after 5 attempts the
  message is `DEAD` and visible in `claims outbox list` until an operator retries it;
- the worker wakes on `LISTEN/NOTIFY` (sent at commit) and polls every 2 s as a fallback;
- the mock payment gateway stores payments by idempotency key, so a retried or duplicated message
  returns the original payment instead of paying twice; fault injection
  (`claims mock gateway fail-next 2`) demonstrates it;
- notifications are stored in `mock_notifications`; the console shows the subject and a masked
  recipient, never the body.

The CLI never waits for side effects; run `npm run worker` (the API runs a worker in-process). The
scenario runner drains the outbox in-process on a simulated clock, fast-forwarding through
retries.

## Refused attempts

Refusals are evidence too (who tried to approve what, when), but they are not part of the claim's
history and must not let anyone flood the database. They go to `denied_attempts`, outside the hash
chain, at most one row per (claim, user, transition, error code) per minute
(`UNIQUE NULLS NOT DISTINCT … ON CONFLICT DO NOTHING`). The trade-off is that a burst of identical
refusals shows as one row.

## Choices not made

- **XState**: guards return a boolean, so explaining *why* a transition is blocked would still be
  custom code; the graph is flat, and the engine core is small enough to read in one sitting.
- **An ORM**: the integrity rules live in SQL (triggers, deferred constraints, generated columns,
  `SKIP LOCKED`), which is clearer written by hand.
- **Event sourcing**: the claim row plus a verifiable patch log gives the same auditability with
  simpler reads; the audit trail can still be replayed (that is what `verify` does).

## Limitations

- Authentication is simulated (`--as`, `X-User-Id`); a deployment would take the user and roles
  from a verified token.
- Time-based transitions (closing after the appeal window) run when the scheduler pass is
  triggered (`claims system run`, the API's button, or cron); there is no durable timer service.
- Coverage is a single per-policy limit, as in the challenge; remaining benefit per year or per
  treatment is not modelled.
- Moving open claims to a newer workflow version is not implemented.
