-- Claims workflow schema (PostgreSQL 17+).
-- Runs inside the schema selected by search_path, as claims_owner. The application connects as
-- claims_app, which can read and insert audit records but never update or delete them.

-- ── Helpers ──────────────────────────────────────────────────────────────────────────────────

-- Raised for UPDATE / DELETE / TRUNCATE on append-only tables.
CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- ── Reference data ───────────────────────────────────────────────────────────────────────────

-- Immutable copies of every workflow definition a claim has been pinned to.
CREATE TABLE workflow_definitions (
  config_hash   text PRIMARY KEY CHECK (config_hash ~ '^[0-9a-f]{64}$'),
  workflow_id   text NOT NULL CHECK (workflow_id ~ '^[a-z][a-z0-9_]*$'),
  version       integer NOT NULL CHECK (version >= 1),
  content       jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  registered_at timestamptz NOT NULL,
  CONSTRAINT workflow_definitions_version_unique UNIQUE (workflow_id, version)
);

CREATE TABLE users (
  id              text PRIMARY KEY,
  display_name    text NOT NULL,
  roles           text[] NOT NULL CHECK (cardinality(roles) > 0),
  member_id       text,
  service_account boolean NOT NULL DEFAULT false
);

CREATE TABLE policies (
  id             text PRIMARY KEY,
  member_id      text NOT NULL,
  product        text NOT NULL,
  coverage_limit bigint NOT NULL CHECK (coverage_limit > 0 AND coverage_limit < 9007199254740992),
  currency       char(3) NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  effective_from date NOT NULL,
  effective_to   date NOT NULL,
  CHECK (effective_to > effective_from)
);

-- ── Claims (current state) ───────────────────────────────────────────────────────────────────

CREATE SEQUENCE claim_no_seq;

CREATE TABLE claims (
  id               uuid PRIMARY KEY,
  claim_no         text NOT NULL UNIQUE CHECK (claim_no ~ '^CLM-[0-9]{4}-[0-9]{6}$'),
  config_hash      text NOT NULL REFERENCES workflow_definitions (config_hash),
  policy_id        text NOT NULL REFERENCES policies (id),
  member_id        text NOT NULL,
  claim_type       text NOT NULL,
  claimed_amount   bigint NOT NULL CHECK (claimed_amount > 0 AND claimed_amount < 9007199254740992),
  state            text NOT NULL,
  state_entered_at timestamptz NOT NULL,
  version          integer NOT NULL CHECK (version >= 1),
  data             jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(data) = 'object'),
  counters         jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(counters) = 'object'),
  participants     jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(participants) = 'object'),
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  CHECK (updated_at >= created_at),
  CHECK (state_entered_at >= created_at),
  -- Projection for work queues ("claims assigned to me"). The config validator requires
  -- fields.assessor_id to be a user_ref so this column stays meaningful.
  assessor_id      text GENERATED ALWAYS AS (data ->> 'assessor_id') STORED
);

CREATE INDEX claims_state_idx ON claims (state);
CREATE INDEX claims_assessor_idx ON claims (assessor_id) WHERE assessor_id IS NOT NULL;
CREATE INDEX claims_policy_idx ON claims (policy_id);
CREATE INDEX claims_member_idx ON claims (member_id);

-- ── Audit trail (append-only, hash-chained per claim) ────────────────────────────────────────

CREATE TABLE audit_log (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id         uuid NOT NULL UNIQUE,
  claim_id         uuid NOT NULL REFERENCES claims (id),
  claim_seq        integer NOT NULL CHECK (claim_seq >= 1),
  transition_id    text NOT NULL,
  from_state       text,
  to_state         text NOT NULL,
  state_changed    boolean GENERATED ALWAYS AS (from_state IS DISTINCT FROM to_state) STORED,
  actor_user_id    text NOT NULL REFERENCES users (id),
  actor_role       text NOT NULL,
  reason           text,
  notes            text,
  input            jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(input) = 'object'),
  changes          jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
  decision_context jsonb NOT NULL CHECK (jsonb_typeof(decision_context) = 'object'),
  effects          jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(effects) = 'array'),
  config_hash      text NOT NULL REFERENCES workflow_definitions (config_hash),
  claim_version    integer NOT NULL,
  snapshot_hash    text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  prev_hash        text NOT NULL CHECK (prev_hash = 'GENESIS' OR prev_hash ~ '^[0-9a-f]{64}$'),
  hash             text NOT NULL UNIQUE CHECK (hash ~ '^[0-9a-f]{64}$'),
  occurred_at      timestamptz NOT NULL,
  CONSTRAINT audit_log_seq_unique UNIQUE (claim_id, claim_seq),
  CONSTRAINT audit_log_version_unique UNIQUE (claim_id, claim_version),
  CHECK (claim_version = claim_seq),
  CHECK ((claim_seq = 1) = (from_state IS NULL)),
  CHECK ((claim_seq = 1) = (prev_hash = 'GENESIS'))
);

CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id, occurred_at);
CREATE INDEX audit_log_transition_idx ON audit_log (transition_id);

-- Refused attempts. Kept apart from the claim's hash chain and de-duplicated per minute, so
-- repeated denials cannot flood the table.
CREATE TABLE denied_attempts (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_id      uuid REFERENCES claims (id),
  actor_user_id text NOT NULL,
  actor_role    text,
  transition_id text NOT NULL,
  error_code    text NOT NULL CHECK (error_code ~ '^[A-Z][A-Z0-9_]*$'),
  message       text NOT NULL,
  details       jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object'),
  occurred_at   timestamptz NOT NULL,
  bucket_start  timestamptz NOT NULL,
  CHECK (bucket_start <= occurred_at),
  CONSTRAINT denied_attempts_dedupe
    UNIQUE NULLS NOT DISTINCT (claim_id, actor_user_id, transition_id, error_code, bucket_start)
);

CREATE INDEX denied_attempts_claim_idx ON denied_attempts (claim_id, occurred_at);
CREATE INDEX denied_attempts_time_idx ON denied_attempts (occurred_at);

-- ── Transactional outbox and idempotency ─────────────────────────────────────────────────────

CREATE TABLE outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_id        uuid NOT NULL REFERENCES claims (id),
  audit_entry_id  uuid NOT NULL REFERENCES audit_log (entry_id),
  effect_type     text NOT NULL CHECK (effect_type IN ('notify', 'trigger_payment', 'log')),
  payload         jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  idempotency_key text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'DEAD')),
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts    integer NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  next_attempt_at timestamptz NOT NULL,
  locked_by       text,
  locked_until    timestamptz,
  last_error      text,
  result          jsonb,
  created_at      timestamptz NOT NULL,
  processed_at    timestamptz,
  CHECK ((status = 'PROCESSING') = (locked_by IS NOT NULL AND locked_until IS NOT NULL)),
  CHECK ((status = 'DONE') = (processed_at IS NOT NULL)),
  CHECK (attempts <= max_attempts)
);

CREATE INDEX outbox_ready_idx ON outbox (next_attempt_at) WHERE status IN ('PENDING', 'FAILED');
CREATE INDEX outbox_lease_idx ON outbox (locked_until) WHERE status = 'PROCESSING';
CREATE INDEX outbox_claim_idx ON outbox (claim_id);

CREATE TABLE idempotency_keys (
  key           text PRIMARY KEY CHECK (length(key) BETWEEN 8 AND 200),
  actor_user_id text NOT NULL REFERENCES users (id),
  request_hash  text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  claim_id      uuid REFERENCES claims (id),
  response      jsonb NOT NULL,
  created_at    timestamptz NOT NULL
);

CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);

-- ── Mock external systems (persisted so idempotency holds across processes) ─────────────────

CREATE TABLE mock_gateway_payments (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  claim_id        uuid NOT NULL REFERENCES claims (id),
  amount          bigint NOT NULL CHECK (amount > 0),
  reference       text NOT NULL,
  gateway_ref     text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL
);

-- Single row: how many upcoming gateway calls should fail (fault injection for demos and tests).
CREATE TABLE mock_gateway_faults (
  id                 smallint PRIMARY KEY CHECK (id = 1),
  remaining_failures integer NOT NULL DEFAULT 0 CHECK (remaining_failures >= 0)
);
INSERT INTO mock_gateway_faults (id, remaining_failures) VALUES (1, 0);

CREATE TABLE mock_notifications (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  claim_id        uuid NOT NULL REFERENCES claims (id),
  template        text NOT NULL,
  channel         text NOT NULL,
  recipient       jsonb NOT NULL,
  subject         text,
  body            text NOT NULL,
  sent_at         timestamptz NOT NULL
);

CREATE INDEX mock_notifications_claim_idx ON mock_notifications (claim_id);

-- ── Integrity triggers ───────────────────────────────────────────────────────────────────────

CREATE TRIGGER workflow_definitions_append_only BEFORE UPDATE OR DELETE ON workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER workflow_definitions_no_truncate BEFORE TRUNCATE ON workflow_definitions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER denied_attempts_append_only BEFORE UPDATE OR DELETE ON denied_attempts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER denied_attempts_no_truncate BEFORE TRUNCATE ON denied_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER claims_no_delete BEFORE DELETE ON claims
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER claims_no_truncate BEFORE TRUNCATE ON claims
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- A claim moves one version at a time and its identity columns never change.
CREATE FUNCTION claims_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'claim % must move from version % to %, not %',
      OLD.claim_no, OLD.version, OLD.version + 1, NEW.version
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.id, NEW.claim_no, NEW.config_hash, NEW.policy_id, NEW.member_id, NEW.claim_type,
      NEW.claimed_amount, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.claim_no, OLD.config_hash, OLD.policy_id, OLD.member_id, OLD.claim_type,
      OLD.claimed_amount, OLD.created_at) THEN
    RAISE EXCEPTION 'claim % identity columns cannot change', OLD.claim_no
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER claims_guard_update BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION claims_guard_update();

-- The state must exist in the definition the claim is pinned to.
-- Functions that read tables pin search_path to this schema: tests and scenario runs keep
-- several copies of the schema in one database.
CREATE FUNCTION claims_state_in_definition() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workflow_definitions d
    WHERE d.config_hash = NEW.config_hash AND (d.content -> 'states') ? NEW.state
  ) THEN
    RAISE EXCEPTION 'state % is not defined in workflow definition %', NEW.state, NEW.config_hash
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER claims_state_in_definition BEFORE INSERT OR UPDATE OF state, config_hash ON claims
  FOR EACH ROW EXECUTE FUNCTION claims_state_in_definition();

-- Every claim version must have its audit entry by the time the transaction commits.
CREATE FUNCTION claims_require_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM audit_log a WHERE a.claim_id = NEW.id AND a.claim_version = NEW.version
  ) THEN
    RAISE EXCEPTION 'claim % version % has no audit entry: claims change only through the workflow engine',
      NEW.claim_no, NEW.version
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER claims_require_audit AFTER INSERT OR UPDATE ON claims
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION claims_require_audit();

-- ── Privileges for the runtime role ──────────────────────────────────────────────────────────

DO $$
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO claims_app', current_schema());
END;
$$;

GRANT SELECT ON users, policies TO claims_app;
GRANT SELECT, INSERT ON workflow_definitions, audit_log, denied_attempts TO claims_app;
GRANT SELECT, INSERT ON idempotency_keys, mock_gateway_payments, mock_notifications TO claims_app;
GRANT SELECT, INSERT, UPDATE ON claims, outbox TO claims_app;
GRANT SELECT, UPDATE ON mock_gateway_faults TO claims_app;
GRANT USAGE ON SEQUENCE claim_no_seq TO claims_app;
