import type { EntityManager } from 'typeorm';
import type { MockNotification, MockPayment } from '../../domain/types';
import type { MockGatewayRepository } from '../mock-gateway-repository';
import { FaultEntity } from './entities/mock-gateway-fault';
import { PaymentEntity, type PaymentRow } from './entities/mock-gateway-payment';
import { NotificationEntity, type NotificationRow } from './entities/mock-notification';
import { iso } from './rows';

const toPayment = (r: PaymentRow): MockPayment => ({
  idempotency_key: r.idempotency_key,
  claim_id: r.claim_id,
  amount: r.amount,
  reference: r.reference,
  gateway_ref: r.gateway_ref,
  created_at: iso(r.created_at),
});

const toNotification = (r: NotificationRow): MockNotification => ({
  idempotency_key: r.idempotency_key,
  claim_id: r.claim_id,
  template: r.template,
  channel: r.channel,
  recipient: r.recipient as Record<string, unknown>,
  subject: r.subject,
  body: r.body,
  sent_at: iso(r.sent_at),
});

export class PgMockGatewayRepository implements MockGatewayRepository {
  constructor(private readonly manager: EntityManager) {}

  async consumeFault(): Promise<boolean> {
    const r = await this.manager
      .getRepository(FaultEntity)
      .createQueryBuilder()
      .update()
      // A decrement relative to the stored value: SQL expression, no ORM equivalent.
      .set({ remaining_failures: () => 'remaining_failures - 1' })
      .where('id = 1 AND remaining_failures > 0')
      .updateEntity(false)
      .execute();
    return r.affected === 1;
  }

  async setFaults(count: number): Promise<void> {
    await this.manager
      .getRepository(FaultEntity)
      .createQueryBuilder()
      .update()
      .set({ remaining_failures: count })
      .where({ id: 1 })
      .updateEntity(false)
      .execute();
  }

  async recordPayment(p: MockPayment): Promise<MockPayment & { created: boolean }> {
    const payments = this.manager.getRepository(PaymentEntity);
    const inserted = await payments
      .createQueryBuilder()
      .insert()
      .values({ ...p })
      .orIgnore()
      .returning('idempotency_key')
      .updateEntity(false)
      .execute();
    const row = await payments.findOneByOrFail({ idempotency_key: p.idempotency_key });
    return { ...toPayment(row), created: (inserted.raw as unknown[]).length === 1 };
  }

  async listPayments(claimId?: string): Promise<MockPayment[]> {
    const rows = await this.manager.getRepository(PaymentEntity).find({
      where: claimId ? { claim_id: claimId } : {},
      order: { id: 'ASC' },
    });
    return rows.map(toPayment);
  }

  async recordNotification(n: MockNotification): Promise<boolean> {
    const result = await this.manager
      .getRepository(NotificationEntity)
      .createQueryBuilder()
      .insert()
      .values({ ...n })
      .orIgnore()
      .returning('idempotency_key')
      .updateEntity(false)
      .execute();
    return (result.raw as unknown[]).length === 1;
  }

  async listNotifications(claimId?: string): Promise<MockNotification[]> {
    const rows = await this.manager.getRepository(NotificationEntity).find({
      where: claimId ? { claim_id: claimId } : {},
      order: { id: 'ASC' },
    });
    return rows.map(toNotification);
  }
}
