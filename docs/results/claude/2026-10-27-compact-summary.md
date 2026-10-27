# Compacted session summary

Exported from the conversation summary Claude Code produced when the session was compacted. It is
the context the work continued from, starting at "tiếp tục xử lý công việc còn dang dở". The
conversation after that point is in
`2026-10-27-095350-this-session-is-being-continued-from-a-previous-c.agent.md`.

---

## 1. Primary Request and Intent

- Initial request (Vietnamese): "tìm hiểu quy trình thực tế của nghành bảo hiểm sau đó hãy phân tích, lên kê hoạch chi tiết nhũng thứ cần làm, chọn tech stacks, nêu nhưng điểm cần chú ý nếu có, đề xuất những gì mà bạn nghĩ sẽ tốt cho hệ thống, vận hành, trải nghiệm người dùng... Nếu không rõ điều gì hãy hỏi và không đoán".
  - The task is the coding challenge in `D:\work\papaya\requirement.md` ("AI Challenge 14 — Claims Workflow Orchestrator").
  - It asks for a config-driven state machine for the claim lifecycle with preconditions, side effects (mock, console), RBAC, an immutable audit trail (timestamp, from_state, to_state, triggered_by user ID + role, reason/notes) queryable by claim ID, and cycle limiting.
  - The cycle UNDER_ASSESSMENT→PENDING_INFO→DOCUMENTS_VERIFIED→UNDER_ASSESSMENT allows at most 3 loops; the 4th attempt is rejected with exactly "Maximum information requests exceeded — escalate to team lead".
  - It also asks for 5 scenarios, a CLI/web UI, ≥15 tests, a config-only extension shown with a diff, a GitHub push with config + scenario results + audit output, and a timeline estimate.
- Choices from the first round of questions: TypeScript/Node.js; CLI + compact Web UI; assigned-assessor-only rule; SoD + maker-checker (four-eyes); audit hash-chain; outbox + idempotency. Remaining-limit, SLA scheduler and KPI report were not chosen and are proposals only.
- Plan rejection feedback (verbatim, must be honored):
  "Gộp commands vào transitions kèm khai báo inputs và templates trong config (mục 1, 2). Đây là điều kiện để demo "chỉ sửa config" đứng vững.
  Gọi transition theo id và dùng counter vòng lặp có tên (mục 4, 5).
  Kiểm tra tĩnh các path trong DSL và gắn config hash vào DB (mục 7, 8).
  Dùng BEGIN IMMEDIATE, ghi idempotency trong cùng transaction, nhận việc outbox nguyên tử, lưu mock gateway vào DB (mục 11, 12).
  A1: dùng snapshot_hash và changes trong audit, verify claim row so với entry cuối. Đây là điểm toàn vẹn quan trọng nhất còn thiếu.
  B1: lưu counters và participants trong claim, bỏ việc đọc lịch sử audit khi đánh giá, giới hạn ghi \*_DENIED.
  A3 + B3: bật foreign_keys, dùng bảng STRICT, CHECK, generated column, và danh sách index trong migration.
  A2: snapshot dữ liệu tham chiếu và config hash vào mỗi quyết định.
  B5/B6: dispatch outbox không chặn CLI, scenario runner chạy cùng tiến trình."
  Plus the comment on SQLite: "tôi muốn dùng postgre".
- Choices from the second round of questions: install PostgreSQL directly (native); DENIED attempts go to a separate append-only table, deduped per minute; claims pinned by config_hash; keep the full scope (~12h).
- The approved plan lives at `C:\Users\Admin\.claude\plans\ti-m-hi-u-quy-tri-nh-binary-blum.md` (Vietnamese; ≈12.5h estimate with a cut order).
- Later answers:
  - "Tôi tự cài" (the user installs PostgreSQL themselves).
  - "tiếp tục" (continue after an interruption).
  - Git identity "nguyentrungsi6997 <gmail>".
  - `.env`: "Điền sau" (the user will fill in the postgres password later).

## 2. Key Technical Concepts

- Node 24.11.1, TypeScript 7.0.2 (strict, ESM, moduleResolution Bundler, noEmit, `types: ["node"]`), tsx, Biome 2.6.3, Vitest 5.0.5, Zod 4.6.7 (z.strictObject, z.discriminatedUnion, z.lazy, z.toJSONSchema), yaml 2.9.1.
- Libraries: canonicalize 5.1.0 (RFC 8785, default export), fast-json-patch 3.1.1 (default import; compare/applyPatch), pg 8.23.1, commander 15, @clack/prompts 1.8.1, picocolors, cli-table3, fastify 5, React 19/Vite 8/Tailwind 4/TanStack Query/Mermaid 12.
- PostgreSQL 18 is installed locally (service postgresql-x64-18, port 5432); the code targets 17+, and docker-compose/CI use postgres:17.
- DSL design:
  - Three transition kinds: create (no `from`), move (from + to), stay (no `to`).
  - `$path` references and `{path|filter}` placeholders, all statically type-checked against `fields`/inputs/settings/counters/participants.
  - Named counters with `increments`; every cycle must increment a bounded counter.
  - The `{ref: rule}` shorthand is desugared.
  - Config hash = SHA-256 of the canonical normalized file. Claims are pinned by config_hash; definitions are immutable in the DB; changing content without bumping the version is refused (CONFIG_VERSION_NOT_BUMPED).
- Engine:
  - Pure; check order: transition → claim/terminal/from → expected_version → RBAC → input → ABAC → counters → max_actions → preconditions. All precondition failures are reported together; conditions depending on missing inputs/paths are skipped.
  - The plan carries the after snapshot, JSON Patch changes, snapshot_hash, decision_context (reads + checks + config_hash) and outbox drafts.
- Integrity:
  - Per-claim HMAC-SHA256 audit chain (GENESIS).
  - verify = chain links + HMAC + replay of changes against each snapshot_hash + claim row vs. last entry (CLAIM_ROW_TAMPERED with diff) + definition hash.
  - DB-level: append-only triggers (incl. TRUNCATE); a deferred constraint trigger requires an audit entry per claim version; a version guard (+1 only, identity columns immutable); the state must exist in the pinned definition; least-privilege roles claims_owner and claims_app.
- Concurrency: READ COMMITTED + `SELECT … FOR UPDATE` (the Postgres equivalent of BEGIN IMMEDIATE); `pg_advisory_xact_lock(hashtextextended(key,0))` for idempotency keys; the idempotency record is written in the same transaction.
- Outbox: transactional; worker leases with `FOR UPDATE SKIP LOCKED` and a lease; reaper for expired leases; exponential backoff (1s…60s, max 5 attempts → DEAD); LISTEN/NOTIFY on channel `claims_outbox` with the schema name as payload; idempotent handlers; mock gateway/notifications persisted in DB; fault injection via the mock_gateway_faults table. The CLI doesn't block; the worker is a separate process; the scenario runner runs in-process with ManualClock + drain().
- Denied attempts are stored separately, deduplicated per (claim, user, transition, code, minute bucket) with `UNIQUE NULLS NOT DISTINCT` + `ON CONFLICT ON CONSTRAINT denied_attempts_dedupe DO NOTHING`.
- Timestamps are generated by the app (ms precision); `monotonic()` keeps per-claim timestamps strictly increasing; money is integer VND (< 2^53); in pg, int8 → Number and DATE → string.

## 3. Files and Code Sections

- `requirement.md` — challenge spec (committed as-is).
- `.gitignore` — node_modules, dist, coverage, web/dist, .vite, \*.log, .env, .env.\*, !.env.example.
- `package.json`:
  - Scripts: cli (`tsx src/cli/index.ts`), worker, scenarios (`tsx src/scenarios/run.ts`), db:setup (`tsx scripts/db-setup.ts`), db:migrate, db:seed (via cli db …), demo:tamper (`tsx scripts/tamper-demo.ts`), config:validate, config:schema (`tsx scripts/gen-json-schema.ts`), api, dev (concurrently api + vite --config web/vite.config.ts), build:web, test (`vitest run`), test:unit, test:watch, coverage, typecheck (`tsc -p tsconfig.json && tsc -p web/tsconfig.json`), lint (`biome check .`), format.
  - Exact-pinned deps (see section 2).
- `tsconfig.json` — target ES2023, module ESNext, moduleResolution Bundler, types ["node"], strict, noUncheckedIndexedAccess, verbatimModuleSyntax, noEmit; include ["src","tests","scripts","vitest.config.ts"]. Note: web/tsconfig.json does not exist yet, so `npm run typecheck` would fail until it is created.
- `biome.json` — `$schema: ./node_modules/@biomejs/biome/configuration_schema.json`, space indent 2, lineWidth 100, single quotes, includes excluding docs/results and config/workflow.schema.json.
- `vitest.config.ts` — include tests/\*\*/\*.test.ts, testTimeout 20000, hookTimeout 30000, v8 coverage of src excluding cli/api/scenarios.
- `.env.example` (and `.env` copied from it, git-ignored) — DATABASE_ADMIN_URL=postgres://postgres:CHANGE_ME@localhost:5432/postgres, CLAIMS_OWNER_PASSWORD=owner_dev_password, CLAIMS_APP_PASSWORD=app_dev_password, DATABASE_URL=postgres://claims_app:app_dev_password@localhost:5432/claims_dev, DATABASE_OWNER_URL=postgres://claims_owner:owner_dev_password@localhost:5432/claims_dev, DB_SCHEMA=claims, TEST_DATABASE_URL=postgres://claims_owner:owner_dev_password@localhost:5432/claims_test, AUDIT_HMAC_KEY=dev-only-change-me, WORKFLOW_CONFIG=config/workflow.yaml.
- `docker-compose.yml` — postgres:17 with POSTGRES_PASSWORD=postgres, healthcheck, volume pgdata at /var/lib/postgresql/data.
- `CLAUDE.md` — architecture rules for AI assistants:
  - engine is pure; no workflow-specific TS; every path type-checked; the engine never reads audit history;
  - snake_case data and camelCase TS; integer VND; app-generated ms timestamps;
  - migrations are append-only (checksums); audit tables are append-only, so tests drop schemas;
  - Windows: run git via Git Bash; npm scripts cross-platform.
- `src/engine/*` — described in the analysis. Key engine signatures:
  ```ts
  export function evaluateTransition(wf: CompiledWorkflow, claim: ClaimSnapshot | null, req: EvaluateRequest, refs: EvaluateRefs, env: EngineEnv): EvaluateResult
  export function availableTransitions(wf, claim, actor, refs, env): AvailableTransition[]
  export function resolveActor(wf, user: User | undefined, userId: string, requestedRole?: string, transitionId?: string): Actor
  export function buildContext(wf, claim, policy, actor, input, now): RuntimeContext
  ```
  Outbox keys: `notify:${entryId}:${index}`, `payment:${after.id}:${reference}`, `log:${entryId}:${index}`.
- `config/workflow.yaml` — v1 workflow, full content written (17 transitions, rules, templates, fields, counters). State descriptions are quoted. Biome later reformatted the YAML (double quotes); it still validates with zero warnings.
- `config/seed.yaml` — users/policies as listed in the analysis.
- `config/workflow.schema.json` — generated (not committed yet).
- `src/domain/types.ts` — ClaimSnapshot, Policy, User, Actor, JsonPatchOp, AuditEntry (entry_id, claim_id, claim_seq, transition_id, from_state|null, to_state, actor_user_id, actor_role, reason, notes, input, changes, decision_context, effects, config_hash, claim_version, snapshot_hash, prev_hash, hash, occurred_at), DeniedAttempt, OutboxStatus, OutboxMessage.
- `src/app/seed.ts` — `loadSeed(path='config/seed.yaml'): SeedData`.
- `tests/helpers/engine-harness.ts`, `tests/unit/engine.test.ts` (32 tests), `tests/unit/config.test.ts` (17 tests) — all 49 pass.
- `src/infra/env.ts`:
  ```ts
  export const env = { databaseUrl: () => required('DATABASE_URL'), ownerUrl: () => required('DATABASE_OWNER_URL'), adminUrl: () => required('DATABASE_ADMIN_URL'), testUrl: () => required('TEST_DATABASE_URL'), schema: () => optional('DB_SCHEMA', 'claims'), workflowConfig: () => optional('WORKFLOW_CONFIG', 'config/workflow.yaml'), auditKey: () => {/* warns and uses 'dev-only-insecure-key' if unset */} };
  ```
- `src/infra/db/pool.ts` — `createPool(connectionString, schema, max=10)` with custom types (int8 → safe Number, DATE 1082 → raw string) and `options: -c search_path=${schema} -c TimeZone=UTC`; `SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/`; `type Db = pg.Pool | pg.PoolClient`; `inTransaction`.
- `src/infra/db/migrations/001_init.sql`:
  - Tables:
    - workflow_definitions (config_hash PK, UNIQUE workflow_definitions_version_unique (workflow_id, version)).
    - users; policies.
    - claim_no_seq; claims (CHECKs; generated `assessor_id text GENERATED ALWAYS AS (data ->> 'assessor_id') STORED`; indexes on state, assessor partial, policy, member).
    - audit_log (generated state_changed; UNIQUE audit_log_seq_unique, audit_log_version_unique; CHECKs claim_version = claim_seq, (claim_seq = 1) = (from_state IS NULL), (claim_seq = 1) = (prev_hash = 'GENESIS')).
    - denied_attempts (CONSTRAINT denied_attempts_dedupe UNIQUE NULLS NOT DISTINCT (claim_id, actor_user_id, transition_id, error_code, bucket_start)).
    - outbox (status CHECK, lease CHECKs, partial indexes).
    - idempotency_keys; mock_gateway_payments; mock_gateway_faults (single row id=1); mock_notifications.
  - Triggers:
    - forbid_mutation on workflow_definitions/audit_log/denied_attempts (row UPDATE/DELETE + statement TRUNCATE) and on claims DELETE/TRUNCATE;
    - claims_guard_update (version must be +1; identity columns immutable);
    - claims_state_in_definition;
    - deferred constraint trigger claims_require_audit.
  - GRANTs to claims_app, including `GRANT USAGE ON SCHEMA` via DO/format(current_schema()).
- `src/infra/db/migrate.ts` — `migrate(pool)`: creates schema_migrations (version, checksum, applied_at), applies `NNN_*.sql` files in order (CRLF normalized), refuses modified applied migrations.
- `scripts/db-setup.ts`:
  - Uses the admin URL; ensureRole claims_owner/claims_app with `admin.escapeLiteral(password)`; `GRANT claims_app TO claims_owner`.
  - Creates databases for DATABASE_URL and TEST_DATABASE_URL with owner claims_owner, then `CREATE SCHEMA IF NOT EXISTS <DB_SCHEMA>` as owner.
  - Prints "Next: npm run db:migrate && npm run db:seed".
- `src/app/audit-chain.ts` — `GENESIS`, `hashedFields(e)` (explicit field list), `computeEntryHash(key, draft) = hmacSha256Hex(key, canonicalJson(hashedFields(e)))`, `buildAuditEntry(plan, head, key)`.
- `src/app/verify.ts` — `verifyClaimChain(claim, entries, key): VerifyReport` with issue codes NO_ENTRIES, SEQUENCE_GAP, CHAIN_BROKEN, ENTRY_TAMPERED, REPLAY_FAILED, REPLAY_MISMATCH, CLAIM_ROW_TAMPERED (diff), DEFINITION_TAMPERED.
- `src/app/clock.ts` — `Clock`, `systemClock`, `ManualClock` (now/advance/set, default '2026-10-20T03:00:00.000Z'), `MINUTE`, `DAY`, `monotonic(now, previousIso)`.
- `src/app/definition-registry.ts` — `DefinitionRegistry(current)` with `registerCurrent(db, now)` (CONFIG_VERSION_NOT_BUMPED ConfigError; handles a unique-violation race), `get(db, hash)` (cached), `loadStored(db, hash)` (bypasses the cache, verifies the hash).
- `src/app/claim-service.ts` — `ClaimService` with:
  - `act(req: ActRequest, internal)`. ActRequest: claim?, transition_id, user_id, role?, input?, expected_version?, idempotency_key?. Flow:
    1. BEGIN; advisory lock on the idempotency key.
    2. `findClaim(... {lock:true})`, or CLAIM_NOT_FOUND.
    3. Idempotency check: replay, or IDEMPOTENCY_KEY_REUSED.
    4. Pinned workflow; loadUsers; SERVICE_ACCOUNT_ONLY unless `asSystem`; resolveActor; findPolicy; nextClaimNo for creation.
    5. evaluateTransition.
    6. update/insert claim; chainHead; buildAuditEntry; insertEntry; enqueue outbox; saveIdempotency.
    7. `pg_notify('claims_outbox', current_schema())`; COMMIT; autoAdvance.
    8. On WorkflowError: ROLLBACK and recordRefusal (unless recordDenied false).
  - Other methods: `autoAdvance(claimId)` (system user svc_system, recordDenied false), `runSystem(claimRef?)`, `getClaim`, `requireClaim`, `listClaims`, `users`, `available(claimRef, userId, role?)` (merges per held role, adds acting_role), `audit`, `denied`, `verify` (+ definition checks), `verifyAll`, `init()`.
  - Exports `SYSTEM_USER = 'svc_system'`.
- `src/app/bootstrap.ts` — `createApp({configPath, databaseUrl, schema, clock, onAutomatic})` returns `{pool, service, workflow, close}`; `migrateSchema(ownerUrl, schema)`, `seedSchema(ownerUrl, schema, seedPath?)`, `resetSchema(ownerUrl, schema)` (DROP SCHEMA CASCADE + migrate + seed).
- `src/infra/repos/claims.ts` — `CLAIM_NO_RE`, `iso()`, `rowToClaim`, `findClaim(db, ref, {lock})` (by claim_no or uuid), `insertClaim`, `updateClaim(db, c, expectedVersion): boolean`, `nextClaimNo(db, year)` → `CLM-YYYY-NNNNNN`, `listClaims(db, {states, assessorId, memberId, limit})`. JSONB params always go through `JSON.stringify`.
- `src/infra/repos/audit.ts` — `rowToEntry`, `insertEntry`, `listEntries`, `findEntry`, `chainHead`, `recordDenied` (minute bucket, ON CONFLICT ON CONSTRAINT denied_attempts_dedupe DO NOTHING), `listDenied`.
- `src/infra/repos/outbox.ts` — `enqueue` (ON CONFLICT (idempotency_key) DO NOTHING RETURNING id), `leaseBatch(db, workerId, now, leaseMs, limit)` (filter `attempts < max_attempts` inside the SKIP LOCKED subquery), `reapExpiredLeases`, `markDone`, `markFailed(db, id, workerId, retryAt, error)` (DEAD when attempts ≥ max), `listOutbox`, `retryDead`.
- `src/infra/repos/reference.ts` — `loadUsers`, `findPolicy`, `listPolicies`, `upsertReference(db, seed)`, definitions (`findDefinition`, `findDefinitionByVersion`, `insertDefinition` ON CONFLICT DO NOTHING, `listDefinitions`), idempotency (`findIdempotency`, `saveIdempotency`).
- `src/infra/repos/mock.ts` — `consumeFault`, `setFaults`, `recordPayment` (returns the existing payment for the key, plus `created`), `listPayments`, `recordNotification`, `listNotifications`.
- `src/infra/outbox/channel.ts` — `export const OUTBOX_CHANNEL = 'claims_outbox';`.
- `src/infra/outbox/handlers.ts` — handlers:
  - notify: records into mock_notifications and logs `[notify] <claim_no> <template> → <masked recipient> via <channel>: "<subject>"` (never the body, because of PII).
  - trigger_payment: consumeFault throws "mock payment gateway unavailable (injected fault)"; gateway_ref `MOCKPAY-${sha256(key).slice(0,10).toUpperCase()}`; logs `[payment] …` with "(already paid: same idempotency key)" on a duplicate.
  - log: logs `[log] message`.
  - `HANDLERS`.
- `src/infra/outbox/worker.ts` — `backoffMs(attempt)`; `OutboxWorker` with:
  - `processOnce()` (reap + lease + handle + markDone/markFailed, logs `[retry]`/`[dead]`);
  - `drain(maxRounds)` (fast-forwards a ManualClock to the next due time);
  - `run(signal)` (LISTEN on a dedicated client, wakes on notification payload === schema, 2s poll fallback, UNLISTEN on exit).
- `src/engine/json-schema.ts`, `scripts/gen-json-schema.ts` — JSON Schema generation (works).
- `src/cli/render.ts` (just written, not yet typechecked) — `out`, `printJson`, `when`, `renderClaim(claim, wf, policy?)` (incl. a documents ✓/✗ checklist), `renderAvailable(userId, roles, transitions)`, `renderResult(result)` (✓/↺ replayed, queued effects, `⚙ system` automatic lines), `renderAudit(entries, {stateChangesOnly})`, `renderDenied`, `renderOutbox`, `renderVerify(report)`, `renderError(error)` (WorkflowError code + message + failures + input_errors + counter; ConfigError issues).

## 4. Errors and fixes

- A YAML comma inside an unquoted flow-mapping description produced "states.SUBMITTED: unknown key 'awaiting document verification'". Fixed by quoting the descriptions.
- `tsx -e` printed nothing, and a scratchpad script couldn't resolve 'yaml'. Used a temporary script inside the project (deleted afterwards).
- The cycle message started at a different node than expected. Updated the test to the actual deterministic output "unbounded cycle DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → PENDING_INFO → DOCUMENTS_VERIFIED (transitions: start_assessment, request_info, info_received): add `increments: [<counter>]` to at least one of these transitions".
- Misleading follow-on precondition failures ("(not set) exceeds the limit"). Added the dependsOnMissing/presenceTarget skip logic, both in check() and in the dry-run; the test now expects only ['ASSESSMENT_INCOMPLETE','APPROVED_AMOUNT_MISSING'], and an "independent failures" test was added.
- TS "Cannot find namespace 'jsonpatch'" in a test. Used `Parameters<typeof jsonpatch.applyPatch>[1]`.
- Biome formatting errors. Fixed with `biome check --write` (it also reformatted YAML); tests still passed.
- Outbox leases expired after the final attempt would hang. Fixed the subquery filter and added reapExpiredLeases.
- Duplicate OUTBOX_CHANNEL. Moved it to channel.ts.
- The IDE showed stale diagnostics during multi-edits; tsc was clean.

## 5. Problem Solving

- Resolved design ambiguities by asking the user (stack, UI, rules, extras, Postgres install method, DENIED policy, pinning, scope, git identity).
- Interpretations documented in the plan:
  - "payment request created" is an internal effect;
  - the counter counts successful request_info calls over the claim's lifetime;
  - "reset assessment timer" = clear `assessment_started_at` and set `assessment_reset_at`;
  - the audit reason/notes columns come from input.reason/notes;
  - placeholders: appeal_period P30D, four_eyes_threshold 50M VND.
- The current state of the DB work: code is written but not executed, because .env still has the CHANGE_ME placeholder (checked via grep without revealing the password).

## 6. All user messages

- "tìm hiểu quy trình thực tế của nghành bảo hiểm sau đó hãy phân tích, lên kê hoạch chi tiết nhũng thứ cần làm, chọn tech stacks, nêu nhưng điểm cần chú ý nếu có, đề xuất những gì mà bạn nghĩ sẽ tốt cho hệ thống, vận hành, trải nghiệm người dùng... Nếu không rõ điều gì hãy hỏi và không đoán"
- First questions answered: TypeScript/Node.js (Recommended); CLI + Web UI gọn (Recommended); "Chỉ assessor được giao (Recommended), SoD + maker-checker"; "Audit hash-chain (Recommended), Outbox + idempotency".
- Plan rejection feedback (verbatim in section 1), including the comment "tôi muốn dùng postgre".
- Second questions answered: "Cài PostgreSQL trực tiếp"; "Bảng riêng, gộp theo phút (Recommended)"; "Pin theo config_hash (Recommended)"; "Giữ đủ phạm vi (~12h)".
- Plan approved.
- "Tôi tự cài" (install Postgres themselves).
- (Interrupted) then "tiếp tục".
- Git identity: "nguyentrungsi6997 <gmail>"; .env: "Điền sau".
- Security/handling constraints in effect:
  - `.env` must never be committed; don't reveal its contents (I only check for the CHANGE_ME placeholder).
  - Ask before pushing to GitHub (gh isn't installed; the user must provide the remote).
  - Don't install software (the user installs PostgreSQL themselves).
  - The user's email is used only for git authorship (approved).
  - Mask PII in logs; don't log notification bodies (health data is sensitive).

## 7. Pending Tasks

- CLI and infrastructure:
  - `src/cli/index.ts` (commander), with commands:
    - db: migrate | seed | reset --yes
    - config: validate | diagram | list | schema
    - users; create; list; show <claim> --as; run <claim> <transition> --as [-i k=v] [--reason] [--notes] [--role] [--expected-version] [--idempotency-key]
    - audit <claim> [--state-changes-only] [--json]; denied [claim]; verify [claim] | --all
    - outbox list | process --once | retry <id>; worker; system run [--claim] [--now ISO]
    - mock gateway fail-next <n> | payments; mock notifications
    - interactive (clack)
    - global --config/--json
  - Typecheck render.ts.
  - Create `web/tsconfig.json` so `npm run typecheck` works.
- Database bring-up and integration tests:
  - Once the user fills .env: run `npm run db:setup`, `npm run db:migrate`, `npm run db:seed`, and fix any SQL issues.
  - Integration test helper `tests/helpers/pg-schema.ts`: a schema per test file in claims_test as owner; app pool derived from claims_app credentials; DROP SCHEMA in afterAll; skip if no DB.
  - Integration tests (~65 total planned): DB constraints/triggers, the deferred audit trigger, privileges via SET ROLE claims_app, concurrency/idempotency, outbox/worker (SKIP LOCKED, lease, retry, DEAD), denied dedupe, verify/tamper detection, pinning/registry.
- Scenarios and the config-only demo:
  - Scenario runner `src/scenarios/run.ts`, in-process with ManualClock + worker.drain(), 12 scenarios, writing `docs/results/scenarios.md`, `audit-trails.json` (+ .md), `denied-attempts.md`, `test-report.txt`.
  - `config/examples/workflow.appeal.yaml` (v2: UNDER_APPEAL, file_appeal with counter appeals max 1, reopen_assessment with SoD, assign_assessor.from += UNDER_APPEAL, 2 new templates) as a separate YAML-only commit.
  - `docs/extending-the-workflow.md` (diff + snippets for intake-missing-docs, payment-failed, escalation).
- Remaining scripts, UI and docs:
  - `scripts/tamper-demo.ts`.
  - API (Fastify, RFC 9457) + Web UI (React/Vite/Tailwind/Mermaid, dynamic forms from inputs, acting-as switcher, audit timeline, verify button).
  - README (Windows + Docker quickstart, decisions, estimate vs. actual timeline, results, future work), `docs/design.md`, `docs/domain-research.md`, `docs/ai-workflow.md`, `.github/workflows/ci.yml` (postgres:17 service).
- Commits after each phase (Conventional Commits ending with "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"), run through Git Bash. Ask before any push.

## 8. Current Work

Phase 3/4 (PostgreSQL layer, service, outbox worker) and the start of Phase 5 (CLI). Most recently:

- wrote `src/engine/json-schema.ts` and `scripts/gen-json-schema.ts`, and generated `config/workflow.schema.json` (output: "wrote config/workflow.schema.json", keys title,description,$schema,type,properties,required,additionalProperties,$defs, size 11775);
- before that, wrote `src/cli/render.ts`.

The last full `npx tsc -p tsconfig.json` (exit 0) ran before render.ts and json-schema.ts were written. None of the DB code has been executed yet: `.env` still contains the CHANGE_ME placeholder.

Git state:

- Commits so far: daed54e (bootstrap) and 7a7dc84 (engine).
- All Phase 3/4/5 files are uncommitted: src/infra/\*\*, src/app/{audit-chain,verify,clock,definition-registry,claim-service,bootstrap}.ts, scripts/db-setup.ts, scripts/gen-json-schema.ts, src/engine/json-schema.ts, src/cli/render.ts, config/workflow.schema.json, plus the src/domain/types.ts additions.

## 9. Optional Next Step

Continue Phase 5 as planned ("Phase 5 — CLI (commands + interactive + `--json`, worker/outbox/mock/system)"):

1. Typecheck the new files (render.ts, json-schema.ts).
2. Write `src/cli/index.ts` with commander commands as listed in Pending Tasks, using `createApp`/`migrateSchema`/`seedSchema`/`resetSchema` from `src/app/bootstrap.ts`, `OutboxWorker` for `worker`/`outbox process`, and the render helpers.
3. Then write the Postgres integration test helper.
4. Re-check `.env` for the CHANGE_ME placeholder (without printing secrets). Once the user has filled it in, run `npm run db:setup && npm run db:migrate && npm run db:seed`, then the integration tests, then commit the phase.

This follows the user's "tiếp tục" instruction and their answer "Điền sau" (the user will fill in the postgres password later, so DB-dependent code is written first and run once it's filled).
