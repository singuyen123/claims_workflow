import type { MockNotification, MockPayment } from '../../domain/types';
import type { Db } from '../../infra/db/pool';
import type { MockGatewayRepository } from '../mock-gateway-repository';
import { iso } from './rows';

export class PgMockGatewayRepository implements MockGatewayRepository {
  constructor(private readonly db: Db) {}

  async consumeFault(): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE mock_gateway_faults SET remaining_failures = remaining_failures - 1
        WHERE id = 1 AND remaining_failures > 0`,
    );
    return r.rowCount === 1;
  }

  async setFaults(count: number): Promise<void> {
    await this.db.query('UPDATE mock_gateway_faults SET remaining_failures = $1 WHERE id = 1', [
      count,
    ]);
  }

  async recordPayment(p: MockPayment): Promise<MockPayment & { created: boolean }> {
    const inserted = await this.db.query(
      `INSERT INTO mock_gateway_payments (idempotency_key, claim_id, amount, reference, gateway_ref, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [p.idempotency_key, p.claim_id, p.amount, p.reference, p.gateway_ref, p.created_at],
    );
    const { rows } = await this.db.query(
      `SELECT idempotency_key, claim_id, amount, reference, gateway_ref, created_at
         FROM mock_gateway_payments WHERE idempotency_key = $1`,
      [p.idempotency_key],
    );
    const row = rows[0];
    return { ...row, created_at: iso(row.created_at), created: inserted.rowCount === 1 };
  }

  async listPayments(claimId?: string): Promise<MockPayment[]> {
    const { rows } = await this.db.query(
      `SELECT idempotency_key, claim_id, amount, reference, gateway_ref, created_at
         FROM mock_gateway_payments ${claimId ? 'WHERE claim_id = $1' : ''} ORDER BY id`,
      claimId ? [claimId] : [],
    );
    return rows.map((r) => ({ ...r, created_at: iso(r.created_at) }));
  }

  async recordNotification(n: MockNotification): Promise<boolean> {
    const r = await this.db.query(
      `INSERT INTO mock_notifications (idempotency_key, claim_id, template, channel, recipient, subject, body, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        n.idempotency_key,
        n.claim_id,
        n.template,
        n.channel,
        JSON.stringify(n.recipient),
        n.subject,
        n.body,
        n.sent_at,
      ],
    );
    return r.rowCount === 1;
  }

  async listNotifications(claimId?: string): Promise<MockNotification[]> {
    const { rows } = await this.db.query(
      `SELECT idempotency_key, claim_id, template, channel, recipient, subject, body, sent_at
         FROM mock_notifications ${claimId ? 'WHERE claim_id = $1' : ''} ORDER BY id`,
      claimId ? [claimId] : [],
    );
    return rows.map((r) => ({ ...r, sent_at: iso(r.sent_at) }));
  }
}
