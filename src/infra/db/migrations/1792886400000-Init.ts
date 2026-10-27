// Claims workflow schema (PostgreSQL 17+). Runs inside the schema of the owner's data source,
// as claims_owner. The application connects as claims_app, which can read and insert audit
// records but never update or delete them.
//
// Tables, keys, checks and indexes use TypeORM's schema API, with the names PostgreSQL gave them
// when this schema was plain SQL. Functions, triggers, the sequence and grants have no such API
// and are SQL. So are the two generated columns: the API records them in typeorm_metadata, a
// table TypeORM creates only while the loaded entities declare generated columns, which would
// make this migration depend on the entities of whatever release runs it.
import {
  type MigrationInterface,
  type QueryRunner,
  Table,
  TableCheck,
  type TableColumnOptions,
  TableForeignKey,
  TableIndex,
  TableUnique,
} from 'typeorm';

type Column = TableColumnOptions;

const text = (name: string, options: Partial<Column> = {}): Column => ({
  name,
  type: 'text',
  ...options,
});
const timestamptz = (name: string, options: Partial<Column> = {}): Column => ({
  name,
  type: 'timestamptz',
  ...options,
});
const jsonb = (name: string, options: Partial<Column> = {}): Column => ({
  name,
  type: 'jsonb',
  ...options,
});
const identity = (table: string): Column => ({
  name: 'id',
  type: 'bigint',
  isPrimary: true,
  primaryKeyConstraintName: `${table}_pkey`,
  isGenerated: true,
  generationStrategy: 'identity',
  generatedIdentity: 'ALWAYS',
});
const primary = (table: string, name: string, type: string): Column => ({
  name,
  type,
  isPrimary: true,
  primaryKeyConstraintName: `${table}_pkey`,
});
/** A check on one column, named like PostgreSQL names column checks. */
const columnCheck = (table: string, column: string, expression: string) =>
  new TableCheck({ name: `${table}_${column}_check`, columnNames: [column], expression });
/** A check over several columns: PostgreSQL names them table_check, table_check1, … */
const tableChecks = (table: string, expressions: string[]) =>
  expressions.map(
    (expression, i) => new TableCheck({ name: `${table}_check${i || ''}`, expression }),
  );
const unique = (table: string, column: string) =>
  new TableUnique({ name: `${table}_${column}_key`, columnNames: [column] });
const references = (table: string, column: string, target: string, targetColumn = 'id') =>
  new TableForeignKey({
    name: `${table}_${column}_fkey`,
    columnNames: [column],
    referencedTableName: target,
    referencedColumnNames: [targetColumn],
  });
const isObject = (table: string, column: string) =>
  columnCheck(table, column, `jsonb_typeof(${column}) = 'object'`);
const isArray = (table: string, column: string) =>
  columnCheck(table, column, `jsonb_typeof(${column}) = 'array'`);
const SHA256 = `~ '^[0-9a-f]{64}$'`;

const TABLES_IN_DEPENDENCY_ORDER = [
  'workflow_definitions',
  'users',
  'policies',
  'claims',
  'audit_log',
  'denied_attempts',
  'outbox',
  'idempotency_keys',
  'mock_gateway_payments',
  'mock_gateway_faults',
  'mock_notifications',
];

export class Init1792886400000 implements MigrationInterface {
  name = 'Init1792886400000';

  async up(q: QueryRunner): Promise<void> {
    // Schemas created before TypeORM were migrated by a SQL runner that recorded 001_init in
    // schema_migrations; that file created exactly what follows.
    if (await q.hasTable('schema_migrations')) {
      const applied = await q.manager
        .createQueryBuilder()
        .select('m.version', 'version')
        .from('schema_migrations', 'm')
        .where('m.version = :version', { version: '001_init' })
        .getRawOne();
      if (applied) return;
      throw new Error('schema_migrations exists but 001_init was never applied to this schema');
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    // Raised for UPDATE / DELETE / TRUNCATE on append-only tables.
    await q.query(`
      CREATE FUNCTION forbid_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
          USING ERRCODE = 'insufficient_privilege';
      END;
      $$`);

    // ── Reference data ───────────────────────────────────────────────────────────────────────

    // Immutable copies of every workflow definition a claim has been pinned to.
    await q.createTable(
      new Table({
        name: 'workflow_definitions',
        columns: [
          primary('workflow_definitions', 'config_hash', 'text'),
          text('workflow_id'),
          { name: 'version', type: 'integer' },
          jsonb('content'),
          timestamptz('registered_at'),
        ],
        checks: [
          columnCheck('workflow_definitions', 'config_hash', `config_hash ${SHA256}`),
          columnCheck('workflow_definitions', 'workflow_id', `workflow_id ~ '^[a-z][a-z0-9_]*$'`),
          columnCheck('workflow_definitions', 'version', 'version >= 1'),
          isObject('workflow_definitions', 'content'),
        ],
        uniques: [
          new TableUnique({
            name: 'workflow_definitions_version_unique',
            columnNames: ['workflow_id', 'version'],
          }),
        ],
      }),
    );

    await q.createTable(
      new Table({
        name: 'users',
        columns: [
          primary('users', 'id', 'text'),
          text('display_name'),
          text('roles', { isArray: true }),
          text('member_id', { isNullable: true }),
          { name: 'service_account', type: 'boolean', default: 'false' },
        ],
        checks: [columnCheck('users', 'roles', 'cardinality(roles) > 0')],
      }),
    );

    await q.createTable(
      new Table({
        name: 'policies',
        columns: [
          primary('policies', 'id', 'text'),
          text('member_id'),
          text('product'),
          { name: 'coverage_limit', type: 'bigint' },
          { name: 'currency', type: 'char', length: '3', default: `'VND'` },
          { name: 'effective_from', type: 'date' },
          { name: 'effective_to', type: 'date' },
        ],
        checks: [
          columnCheck(
            'policies',
            'coverage_limit',
            'coverage_limit > 0 AND coverage_limit < 9007199254740992',
          ),
          columnCheck('policies', 'currency', `currency = 'VND'`),
          ...tableChecks('policies', ['effective_to > effective_from']),
        ],
      }),
    );

    // ── Claims (current state) ───────────────────────────────────────────────────────────────

    await q.query('CREATE SEQUENCE claim_no_seq');

    const claims = new Table({
      name: 'claims',
      columns: [
        primary('claims', 'id', 'uuid'),
        text('claim_no'),
        text('config_hash'),
        text('policy_id'),
        text('member_id'),
        text('claim_type'),
        { name: 'claimed_amount', type: 'bigint' },
        text('state'),
        timestamptz('state_entered_at'),
        { name: 'version', type: 'integer' },
        jsonb('data', { default: `'{}'` }),
        jsonb('counters', { default: `'{}'` }),
        jsonb('participants', { default: `'{}'` }),
        timestamptz('created_at'),
        timestamptz('updated_at'),
      ],
      uniques: [unique('claims', 'claim_no')],
      checks: [
        columnCheck('claims', 'claim_no', `claim_no ~ '^CLM-[0-9]{4}-[0-9]{6}$'`),
        columnCheck(
          'claims',
          'claimed_amount',
          'claimed_amount > 0 AND claimed_amount < 9007199254740992',
        ),
        columnCheck('claims', 'version', 'version >= 1'),
        isObject('claims', 'data'),
        isObject('claims', 'counters'),
        isObject('claims', 'participants'),
        ...tableChecks('claims', ['updated_at >= created_at', 'state_entered_at >= created_at']),
      ],
      foreignKeys: [
        references('claims', 'config_hash', 'workflow_definitions', 'config_hash'),
        references('claims', 'policy_id', 'policies'),
      ],
      indices: [
        new TableIndex({ name: 'claims_state_idx', columnNames: ['state'] }),
        new TableIndex({ name: 'claims_policy_idx', columnNames: ['policy_id'] }),
        new TableIndex({ name: 'claims_member_idx', columnNames: ['member_id'] }),
      ],
    });
    await q.createTable(claims);
    // Projection for work queues ("claims assigned to me"). The config validator requires
    // fields.assessor_id to be a user_ref so this column stays meaningful.
    await q.query(`
      ALTER TABLE claims
        ADD COLUMN assessor_id text GENERATED ALWAYS AS (data ->> 'assessor_id') STORED`);
    await q.createIndex(
      claims,
      new TableIndex({
        name: 'claims_assessor_idx',
        columnNames: ['assessor_id'],
        where: 'assessor_id IS NOT NULL',
      }),
    );

    // ── Audit trail (append-only, hash-chained per claim) ────────────────────────────────────

    await q.createTable(
      new Table({
        name: 'audit_log',
        columns: [
          identity('audit_log'),
          { name: 'entry_id', type: 'uuid' },
          { name: 'claim_id', type: 'uuid' },
          { name: 'claim_seq', type: 'integer' },
          text('transition_id'),
          text('from_state', { isNullable: true }),
          text('to_state'),
          text('actor_user_id'),
          text('actor_role'),
          text('reason', { isNullable: true }),
          text('notes', { isNullable: true }),
          jsonb('input', { default: `'{}'` }),
          jsonb('changes'),
          jsonb('decision_context'),
          jsonb('effects', { default: `'[]'` }),
          text('config_hash'),
          { name: 'claim_version', type: 'integer' },
          text('snapshot_hash'),
          text('prev_hash'),
          text('hash'),
          timestamptz('occurred_at'),
        ],
        uniques: [
          unique('audit_log', 'entry_id'),
          unique('audit_log', 'hash'),
          new TableUnique({ name: 'audit_log_seq_unique', columnNames: ['claim_id', 'claim_seq'] }),
          new TableUnique({
            name: 'audit_log_version_unique',
            columnNames: ['claim_id', 'claim_version'],
          }),
        ],
        checks: [
          columnCheck('audit_log', 'claim_seq', 'claim_seq >= 1'),
          isObject('audit_log', 'input'),
          isArray('audit_log', 'changes'),
          isObject('audit_log', 'decision_context'),
          isArray('audit_log', 'effects'),
          columnCheck('audit_log', 'snapshot_hash', `snapshot_hash ${SHA256}`),
          columnCheck('audit_log', 'prev_hash', `prev_hash = 'GENESIS' OR prev_hash ${SHA256}`),
          columnCheck('audit_log', 'hash', `hash ${SHA256}`),
          ...tableChecks('audit_log', [
            'claim_version = claim_seq',
            '(claim_seq = 1) = (from_state IS NULL)',
            `(claim_seq = 1) = (prev_hash = 'GENESIS')`,
          ]),
        ],
        foreignKeys: [
          references('audit_log', 'claim_id', 'claims'),
          references('audit_log', 'actor_user_id', 'users'),
          references('audit_log', 'config_hash', 'workflow_definitions', 'config_hash'),
        ],
        indices: [
          new TableIndex({
            name: 'audit_log_actor_idx',
            columnNames: ['actor_user_id', 'occurred_at'],
          }),
          new TableIndex({ name: 'audit_log_transition_idx', columnNames: ['transition_id'] }),
        ],
      }),
    );
    await q.query(`
      ALTER TABLE audit_log
        ADD COLUMN state_changed boolean GENERATED ALWAYS AS (from_state IS DISTINCT FROM to_state) STORED`);

    // Refused attempts. Kept apart from the claim's hash chain and de-duplicated per minute, so
    // repeated denials cannot flood the table.
    await q.createTable(
      new Table({
        name: 'denied_attempts',
        columns: [
          identity('denied_attempts'),
          { name: 'claim_id', type: 'uuid', isNullable: true },
          text('actor_user_id'),
          text('actor_role', { isNullable: true }),
          text('transition_id'),
          text('error_code'),
          text('message'),
          jsonb('details', { default: `'{}'` }),
          timestamptz('occurred_at'),
          timestamptz('bucket_start'),
        ],
        checks: [
          columnCheck('denied_attempts', 'error_code', `error_code ~ '^[A-Z][A-Z0-9_]*$'`),
          isObject('denied_attempts', 'details'),
          ...tableChecks('denied_attempts', ['bucket_start <= occurred_at']),
        ],
        foreignKeys: [references('denied_attempts', 'claim_id', 'claims')],
        indices: [
          new TableIndex({
            name: 'denied_attempts_claim_idx',
            columnNames: ['claim_id', 'occurred_at'],
          }),
          new TableIndex({ name: 'denied_attempts_time_idx', columnNames: ['occurred_at'] }),
        ],
      }),
    );
    // TableUnique has no NULLS NOT DISTINCT (a refusal without a claim is still de-duplicated).
    await q.query(`
      ALTER TABLE denied_attempts ADD CONSTRAINT denied_attempts_dedupe
        UNIQUE NULLS NOT DISTINCT (claim_id, actor_user_id, transition_id, error_code, bucket_start)`);

    // ── Transactional outbox and idempotency ─────────────────────────────────────────────────

    await q.createTable(
      new Table({
        name: 'outbox',
        columns: [
          identity('outbox'),
          { name: 'claim_id', type: 'uuid' },
          { name: 'audit_entry_id', type: 'uuid' },
          text('effect_type'),
          jsonb('payload'),
          text('idempotency_key'),
          text('status', { default: `'PENDING'` }),
          { name: 'attempts', type: 'integer', default: '0' },
          { name: 'max_attempts', type: 'integer', default: '5' },
          timestamptz('next_attempt_at'),
          text('locked_by', { isNullable: true }),
          timestamptz('locked_until', { isNullable: true }),
          text('last_error', { isNullable: true }),
          jsonb('result', { isNullable: true }),
          timestamptz('created_at'),
          timestamptz('processed_at', { isNullable: true }),
        ],
        uniques: [unique('outbox', 'idempotency_key')],
        checks: [
          columnCheck(
            'outbox',
            'effect_type',
            `effect_type IN ('notify', 'trigger_payment', 'log')`,
          ),
          isObject('outbox', 'payload'),
          columnCheck(
            'outbox',
            'status',
            `status IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'DEAD')`,
          ),
          columnCheck('outbox', 'attempts', 'attempts >= 0'),
          columnCheck('outbox', 'max_attempts', 'max_attempts >= 1'),
          ...tableChecks('outbox', [
            `(status = 'PROCESSING') = (locked_by IS NOT NULL AND locked_until IS NOT NULL)`,
            `(status = 'DONE') = (processed_at IS NOT NULL)`,
            'attempts <= max_attempts',
          ]),
        ],
        foreignKeys: [
          references('outbox', 'claim_id', 'claims'),
          references('outbox', 'audit_entry_id', 'audit_log', 'entry_id'),
        ],
        indices: [
          new TableIndex({
            name: 'outbox_ready_idx',
            columnNames: ['next_attempt_at'],
            where: `status IN ('PENDING', 'FAILED')`,
          }),
          new TableIndex({
            name: 'outbox_lease_idx',
            columnNames: ['locked_until'],
            where: `status = 'PROCESSING'`,
          }),
          new TableIndex({ name: 'outbox_claim_idx', columnNames: ['claim_id'] }),
        ],
      }),
    );

    await q.createTable(
      new Table({
        name: 'idempotency_keys',
        columns: [
          primary('idempotency_keys', 'key', 'text'),
          text('actor_user_id'),
          text('request_hash'),
          { name: 'claim_id', type: 'uuid', isNullable: true },
          jsonb('response'),
          timestamptz('created_at'),
        ],
        checks: [
          columnCheck('idempotency_keys', 'key', 'length(key) BETWEEN 8 AND 200'),
          columnCheck('idempotency_keys', 'request_hash', `request_hash ${SHA256}`),
        ],
        foreignKeys: [
          references('idempotency_keys', 'actor_user_id', 'users'),
          references('idempotency_keys', 'claim_id', 'claims'),
        ],
        indices: [
          new TableIndex({ name: 'idempotency_keys_created_idx', columnNames: ['created_at'] }),
        ],
      }),
    );

    // ── Mock external systems (persisted so idempotency holds across processes) ─────────────

    await q.createTable(
      new Table({
        name: 'mock_gateway_payments',
        columns: [
          identity('mock_gateway_payments'),
          text('idempotency_key'),
          { name: 'claim_id', type: 'uuid' },
          { name: 'amount', type: 'bigint' },
          text('reference'),
          text('gateway_ref'),
          timestamptz('created_at'),
        ],
        uniques: [
          unique('mock_gateway_payments', 'idempotency_key'),
          unique('mock_gateway_payments', 'gateway_ref'),
        ],
        checks: [columnCheck('mock_gateway_payments', 'amount', 'amount > 0')],
        foreignKeys: [references('mock_gateway_payments', 'claim_id', 'claims')],
      }),
    );

    // Single row: how many upcoming gateway calls should fail (fault injection for demos and tests).
    await q.createTable(
      new Table({
        name: 'mock_gateway_faults',
        columns: [
          primary('mock_gateway_faults', 'id', 'smallint'),
          { name: 'remaining_failures', type: 'integer', default: '0' },
        ],
        checks: [
          columnCheck('mock_gateway_faults', 'id', 'id = 1'),
          columnCheck('mock_gateway_faults', 'remaining_failures', 'remaining_failures >= 0'),
        ],
      }),
    );
    await q.manager
      .createQueryBuilder()
      .insert()
      .into('mock_gateway_faults', ['id', 'remaining_failures'])
      .values({ id: 1, remaining_failures: 0 })
      .updateEntity(false)
      .execute();

    await q.createTable(
      new Table({
        name: 'mock_notifications',
        columns: [
          identity('mock_notifications'),
          text('idempotency_key'),
          { name: 'claim_id', type: 'uuid' },
          text('template'),
          text('channel'),
          jsonb('recipient'),
          text('subject', { isNullable: true }),
          text('body'),
          timestamptz('sent_at'),
        ],
        uniques: [unique('mock_notifications', 'idempotency_key')],
        foreignKeys: [references('mock_notifications', 'claim_id', 'claims')],
        indices: [
          new TableIndex({ name: 'mock_notifications_claim_idx', columnNames: ['claim_id'] }),
        ],
      }),
    );

    // ── Integrity triggers ───────────────────────────────────────────────────────────────────

    for (const table of ['workflow_definitions', 'audit_log', 'denied_attempts']) {
      await q.query(`
        CREATE TRIGGER ${table}_append_only BEFORE UPDATE OR DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION forbid_mutation()`);
      await q.query(`
        CREATE TRIGGER ${table}_no_truncate BEFORE TRUNCATE ON ${table}
          FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()`);
    }
    await q.query(`
      CREATE TRIGGER claims_no_delete BEFORE DELETE ON claims
        FOR EACH ROW EXECUTE FUNCTION forbid_mutation()`);
    await q.query(`
      CREATE TRIGGER claims_no_truncate BEFORE TRUNCATE ON claims
        FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()`);

    // A claim moves one version at a time and its identity columns never change.
    await q.query(`
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
      $$`);
    await q.query(`
      CREATE TRIGGER claims_guard_update BEFORE UPDATE ON claims
        FOR EACH ROW EXECUTE FUNCTION claims_guard_update()`);

    // The state must exist in the definition the claim is pinned to.
    // Functions that read tables pin search_path to this schema: tests and scenario runs keep
    // several copies of the schema in one database.
    await q.query(`
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
      $$`);
    await q.query(`
      CREATE TRIGGER claims_state_in_definition BEFORE INSERT OR UPDATE OF state, config_hash ON claims
        FOR EACH ROW EXECUTE FUNCTION claims_state_in_definition()`);

    // Every claim version must have its audit entry by the time the transaction commits.
    await q.query(`
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
      $$`);
    await q.query(`
      CREATE CONSTRAINT TRIGGER claims_require_audit AFTER INSERT OR UPDATE ON claims
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION claims_require_audit()`);

    // ── Privileges for the runtime role ──────────────────────────────────────────────────────

    await q.query(`
      DO $$
      BEGIN
        EXECUTE format('GRANT USAGE ON SCHEMA %I TO claims_app', current_schema());
      END;
      $$`);
    await q.query('GRANT SELECT ON users, policies TO claims_app');
    await q.query(
      'GRANT SELECT, INSERT ON workflow_definitions, audit_log, denied_attempts TO claims_app',
    );
    await q.query(
      'GRANT SELECT, INSERT ON idempotency_keys, mock_gateway_payments, mock_notifications TO claims_app',
    );
    await q.query('GRANT SELECT, INSERT, UPDATE ON claims, outbox TO claims_app');
    await q.query('GRANT SELECT, UPDATE ON mock_gateway_faults TO claims_app');
    await q.query('GRANT USAGE ON SEQUENCE claim_no_seq TO claims_app');
  }

  async down(q: QueryRunner): Promise<void> {
    for (const table of [...TABLES_IN_DEPENDENCY_ORDER].reverse()) await q.dropTable(table, true);
    await q.query('DROP SEQUENCE IF EXISTS claim_no_seq');
    await q.query(
      'DROP FUNCTION IF EXISTS claims_require_audit(), claims_state_in_definition(), claims_guard_update(), forbid_mutation()',
    );
  }
}
