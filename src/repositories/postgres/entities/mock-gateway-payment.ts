import { EntitySchema } from 'typeorm';
import type { MockPayment } from '../../../domain/types';
import { identity, type Row } from './columns';

export type PaymentRow = Row<MockPayment, 'created_at'> & { id: number };

export const PaymentEntity = new EntitySchema<PaymentRow>({
  name: 'MockGatewayPayment',
  tableName: 'mock_gateway_payments',
  columns: {
    id: { ...identity, select: false },
    idempotency_key: { type: 'text' },
    claim_id: { type: 'uuid' },
    amount: { type: 'bigint' },
    reference: { type: 'text' },
    gateway_ref: { type: 'text' },
    created_at: { type: 'timestamptz' },
  },
});
