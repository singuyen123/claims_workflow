# Claims Workflow Orchestrator

A state-machine workflow engine for health-insurance claims (AI Challenge 14). The whole claim
lifecycle lives in one config file, [`config/workflow.yaml`](config/workflow.yaml): states,
transitions, roles, typed inputs, preconditions, notifications and loop limits. The engine
interprets it and holds no claim-specific code. Transitions run on PostgreSQL with a hash-chained,
append-only audit trail and a transactional outbox for side effects. You can drive it from a CLI
or a small web UI.

| Deliverable | Where |
|---|---|
| State machine config | [`config/workflow.yaml`](config/workflow.yaml) (v1), [`config/examples/workflow.appeal.yaml`](config/examples/workflow.appeal.yaml) (v2) |
| Scenario results (the 5 required + 7 more) | [`docs/results/scenarios.md`](docs/results/scenarios.md) |
| Audit trail output | [`docs/results/audit-trails.md`](docs/results/audit-trails.md), [`.json`](docs/results/audit-trails.json), refused attempts in [`denied-attempts.md`](docs/results/denied-attempts.md) |
| New state by config only, with the diff | [`docs/extending-the-workflow.md`](docs/extending-the-workflow.md), commit `f2522b3` |
| Tests | 170: 120 unit, 50 integration on PostgreSQL ([`test-report.txt`](docs/results/test-report.txt)) |
| Design, domain research, AI workflow | [`docs/design.md`](docs/design.md), [`docs/domain-research.md`](docs/domain-research.md), [`docs/ai-workflow.md`](docs/ai-workflow.md) |
| Logical thinking answers (Vietnamese) | [`docs/results/logical.txt`](docs/results/logical.txt) |

## Quick start

You need Node.js 22 or later (24 recommended) and PostgreSQL 17 or later, installed natively or
run with Docker.

```sh
npm install
cp .env.example .env            # Windows: copy .env.example .env
```

In `.env`, set the PostgreSQL superuser password in `DATABASE_ADMIN_URL`. It is used once, by
`db:setup`, to create the two roles and the two databases. With Docker, run
`docker compose up -d` and use `postgres://postgres:postgres@localhost:5432/postgres`.

```sh
npm run db:setup                # roles claims_owner / claims_app, databases claims_dev / claims_test
npm run db:migrate && npm run db:seed
npm test                        # unit + integration tests
npm run scenarios               # the 12 scenarios, printed (add -- --write to regenerate docs/results)
```

Without a database, `npm test` still runs the 60 unit tests and skips the integration tests
when `TEST_DATABASE_URL` is unset.

## Using it

### CLI

Side effects (notifications, payments) are delivered by the outbox worker, so start it first:

```sh
npm run worker                                                    # terminal 1
```

Then, in a second terminal:

```sh
npm run cli -- users                                              # demo users and their roles
npm run cli -- create --as u_member_01 --policy POL-001 --type outpatient \
  --amount 2500000 -i treatment_date=2026-10-15                   # → CLM-2026-000001
npm run cli -- show CLM-2026-000001 --as u_clerk_01               # state + what this user can do, and why
npm run cli -- run CLM-2026-000001 approve --as u_assessor_01     # refused: INVALID_TRANSITION, with the way to APPROVED
npm run cli -- run CLM-2026-000001 attach_document --as u_member_01 -i document_type=claim_form
npm run cli -- run CLM-2026-000001 verify_documents --as u_clerk_01   # refused: lists the missing documents
npm run cli -- audit CLM-2026-000001                              # full history: who, when, from → to, reason
npm run cli -- verify CLM-2026-000001                             # hash chain, replay, claim row
npm run cli -- interactive                                        # guided mode with prompts for every input
```

Every command accepts `--json`. Run `npm run cli -- --help` for the full list (`list --queue`,
`denied`, `outbox`, `mock gateway fail-next`, `system run`, `config diagram`, …).

### Web UI

```sh
npm run dev                     # API on :3000 (with the outbox worker) + UI on http://localhost:5173
```

Pick a user at the top right ("Acting as"), open or submit a claim, and run transitions from the
actions panel. The panel shows each transition's roles and a ✓/✗ checklist of what blocks it, and
builds its form from the inputs declared in the config. Refusals appear with their error code and
reasons, and the claim page shows the diagram, audit timeline, refused attempts, notifications and
a verify button.

### Demo users (`config/seed.yaml`)

| User | Roles | Notes |
|---|---|---|
| `u_member_01`, `u_member_02` | member | own policies `POL-001` (limit 100,000,000 VND) and `POL-002` (5,000,000 VND) |
| `u_clerk_01` | document_clerk | |
| `u_lead_01` | team_lead | assigns assessors, co-signs large approvals |
| `u_assessor_01`, `u_assessor_02` | assessor | |
| `u_finance_01` | finance | |
| `u_dual_ca`, `u_dual_af` | clerk + assessor, assessor + finance | for the segregation-of-duties demos |
| `svc_system` | system | service account for automatic transitions; cannot be used directly |

Authentication is simulated (`--as` in the CLI, `X-User-Id` in the API). Every claim route of
the API needs `X-User-Id`: members see their own claims and policies, staff see everything, and
the outbox, refused attempts and the scheduler pass are for staff only (see
[docs/design.md](docs/design.md#read-access)).

## How the requirements are met

| Requirement | Implementation |
|---|---|
| State machine defined in config | `config/workflow.yaml`; the engine (`src/engine`) has no state or transition names. The validator rejects a file with an unknown path, a type mismatch, an unreachable state or an unbounded cycle. |
| Reject invalid transitions with a specific error | Fixed check order with dedicated codes: unknown transition (with "did you mean"), terminal state, wrong state (lists what *is* available and the path to the target), stale version, role, input, authorization, cycle limit, preconditions. |
| Preconditions | Declared per transition from primitives such as `documents_present`, `compare`, `field_present`, `received_since_state_entry`; all failures reported together. Scenario 6. |
| Side effects (mocked, logged) | Internal effects update the claim in the same transaction. Notifications and payments go through a transactional outbox to a worker that logs them (PII masked) and records them in mock tables. Scenario 10 shows retries and idempotency. |
| Role-based authorization | `roles` per transition, plus per-claim rules: assigned assessor, claim owner, segregation of duties, four-eyes above 50,000,000 VND. Scenarios 5, 8, 9. |
| Audit trail: timestamp, from/to state, user + role, reason/notes | `audit_log`, one row per transition, including in-state actions and automatic ones. Each row also holds the JSON Patch of the change, the snapshot hash and the decision context. Query with `claims audit <claim>` or `GET /api/claims/:id/audit`. |
| Audit trail is immutable | Triggers reject UPDATE/DELETE/TRUNCATE even for the owner, the runtime role has no such privileges, a claim cannot change without an audit entry, and `verify` detects edits made with triggers disabled (`npm run demo:tamper`). |
| Cycle limit (3, then the exact message) | Named counter `info_requests` (max 3) with the required message; the validator requires every cycle in the graph to pass through a counted transition. Scenario 7. |
| 5 scenarios | Scenarios 1–5 in [`docs/results/scenarios.md`](docs/results/scenarios.md). |
| CLI or web UI: state + valid transitions with roles, advance, audit | Both. `claims show <claim> --as <user>` and the web actions panel list transitions with roles and blocking reasons. |
| New state or transition by config only, with a diff | Appeal flow in v2, committed alone (`git show --stat f2522b3`). Walkthrough and recipes in [`docs/extending-the-workflow.md`](docs/extending-the-workflow.md). |
| At least 15 tests | 170 tests: engine flows, invalid transitions, preconditions, RBAC/ABAC, cycle limit, config validation, database guarantees, tampering, concurrency, idempotency, outbox and retry policy, read access, API. |

## Design in brief

Full write-up: [`docs/design.md`](docs/design.md).

- **Every action is a transition** declared in the config: creating a claim, changing state, or an
  in-state action such as attaching a document. Each declares typed inputs, roles, authorization,
  counters, preconditions and effects. Clients call transitions by id, and the UI forms are
  generated from the inputs.
- **The engine is pure.** It evaluates a claim snapshot, the reference data, the input and the
  injected time, and returns a plan. The plan holds the new snapshot, a JSON Patch, the snapshot
  hash, the decision context and the outbox messages. It never reads the audit history; counters
  and participants live on the claim.
- **One transaction per transition** on PostgreSQL. An advisory lock on the idempotency key and a
  row lock on the claim come first; then the claim update, the audit entry, the outbox messages
  and the idempotency record commit together. Refusals go to a separate `denied_attempts` table,
  at most one row per kind per minute.
- **Tamper-evident audit.** Each claim's entries form an HMAC-SHA256 chain. `verify` replays the
  patches against each snapshot hash, compares the claim row with the last entry, and re-hashes
  the stored workflow definitions.
- **Versioned definitions.** Each claim is pinned to the hash of the definition it was created
  under. Changing the file without bumping its version is refused at startup.
- **Transactional outbox**: at-least-once delivery with idempotent handlers, `SKIP LOCKED` leases,
  exponential backoff with jitter and a retry schedule per effect type (hours for payments),
  `DEAD` messages with single or bulk retry, and `LISTEN/NOTIFY`. The CLI never waits for side effects.

Stack: TypeScript (strict, ESM) on Node.js, PostgreSQL through TypeORM (`EntitySchema`
repositories and TypeORM migrations), Zod,
`yaml`, RFC 8785 canonical JSON, `fast-json-patch`, commander and @clack/prompts for the CLI,
Fastify for the API, React with TanStack Query, Tailwind and Mermaid for the web UI, Vitest and
Biome.

## Project layout

```
config/            workflow.yaml (v1), examples/workflow.appeal.yaml (v2), seed.yaml, workflow.schema.json
src/engine/        schema, loader, validator, conditions, effects, templates, evaluation, Mermaid
src/controllers/   cli/ (commands, rendering, interactive mode), http/ (Fastify routes, RFC 9457 problem details)
src/services/      claim commands and queries, workflow versions, operations, outbox worker and handlers, verify
src/repositories/  repository interfaces and UnitOfWork; postgres/ holds the TypeORM entities and implementations
src/infra/         TypeORM migrations, plain pg pool for scripts and tests, environment, seed file
src/bootstrap.ts   composition root: wires the PostgreSQL repositories into the services
src/scenarios/     scenario runner and report writer, tamper demo
web/               React UI
tests/             unit/ (engine, config, extension, recipes, layering) and integration/ (PostgreSQL)
docs/              design, domain research, extension guide, AI workflow, results/
```

## Timeline: estimate and actual

The challenge suggests 5–8 hours. After the plan review, the scope was kept at about 12.5 hours
(PostgreSQL integrity rules, outbox, both a CLI and a web UI). Actual times come from the session
timestamps (Vietnam time, 25–26 Oct 2026) and are wall-clock with the AI assistant.

| Phase | Estimate | Actual |
|---|---|---|
| Research and plan, including two review rounds | — | 1 h 20 (21:55–23:16, incl. a 36 min review) |
| 0. Bootstrap (repo, tooling, PostgreSQL install) | 1.25 h | ⏳ |
| 1. DSL, loader, validator | 2.25 h | ⏳ |
| 2. Pure engine | 2.0 h | ⏳ |
| 3. PostgreSQL schema, repositories, service | 2.25 h | ⏳ |
| 4. Outbox worker, verify, tamper demo | 1.25 h | ⏳ |
| 5. CLI | 0.75 h | ⏳ |
| 6. Scenarios and the config-only extension | 0.75 h | ⏳ |
| 7. API and web UI | 1.5 h | ⏳ |
| 8. Docs and CI | 0.5 h | ⏳ |
| **Total** | **12.5 h** | ⏳ |

## Future work

Ordered by value; none of these is implemented.

- **Product**:
  - remaining-benefit checks per year and per treatment;
  - direct billing as a second workflow;
  - an SLA per state with the 15-day payment deadline (art. 31) and automatic escalation;
  - a fraud score as a precondition primitive.
- **Operations**:
  - work queues and assignment by workload and authority;
  - a KPI dashboard (turnaround per step, pend rate, straight-through rate) built from the audit
    trail;
  - alerts on `DEAD` outbox messages and unusual refusal rates;
  - config changes through reviewed pull requests.
- **Platform**:
  - a durable timer service instead of the scheduler pass;
  - migrating open claims to a new workflow version;
  - the HMAC key in a KMS and chain heads anchored outside the database;
  - audit-log partitioning;
  - real authentication.
- **UX**:
  - confirmation for irreversible actions;
  - standard reason templates;
  - member-facing status pages in plain Vietnamese with what is missing and by when.
