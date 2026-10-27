// An outbox row is an instruction to the outside world (a payment, a notification), written in
// the same transaction as the audit entry that lists it. The runtime role used to be able to
// update every column, so application-level SQL could change a payment's amount or claim after
// the fact. From here on it may only move a message through its delivery states, and nobody may
// change what a message says or reopen one that was delivered.
//
// Grants and triggers have no TypeORM schema API, so this migration is SQL.
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The delivery-state columns the worker writes (lease, retry, completion). */
const DELIVERY_COLUMNS = [
  'status',
  'attempts',
  'next_attempt_at',
  'locked_by',
  'locked_until',
  'last_error',
  'result',
  'processed_at',
];

export class ProtectOutbox1792972800000 implements MigrationInterface {
  name = 'ProtectOutbox1792972800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query('REVOKE UPDATE ON outbox FROM claims_app');
    await q.query(`GRANT UPDATE (${DELIVERY_COLUMNS.join(', ')}) ON outbox TO claims_app`);

    // Also binds the owner while triggers are enabled; `verify` compares the rows with the
    // payload hashes in the audit chain for the case where they are not.
    await q.query(`
      CREATE FUNCTION outbox_guard_update() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF (NEW.id, NEW.claim_id, NEW.audit_entry_id, NEW.effect_type, NEW.payload,
            NEW.idempotency_key, NEW.max_attempts, NEW.created_at)
           IS DISTINCT FROM
           (OLD.id, OLD.claim_id, OLD.audit_entry_id, OLD.effect_type, OLD.payload,
            OLD.idempotency_key, OLD.max_attempts, OLD.created_at) THEN
          RAISE EXCEPTION 'outbox message % cannot change: only its delivery state moves', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF OLD.status = 'DONE' AND NEW IS DISTINCT FROM OLD THEN
          RAISE EXCEPTION 'outbox message % was delivered and cannot be reopened', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        RETURN NEW;
      END;
      $$`);
    await q.query(`
      CREATE TRIGGER outbox_guard_update BEFORE UPDATE ON outbox
        FOR EACH ROW EXECUTE FUNCTION outbox_guard_update()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TRIGGER IF EXISTS outbox_guard_update ON outbox');
    await q.query('DROP FUNCTION IF EXISTS outbox_guard_update()');
    await q.query(`REVOKE UPDATE (${DELIVERY_COLUMNS.join(', ')}) ON outbox FROM claims_app`);
    await q.query('GRANT UPDATE ON outbox TO claims_app');
  }
}
