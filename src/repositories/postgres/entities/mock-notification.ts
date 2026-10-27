import { EntitySchema } from 'typeorm';
import type { MockNotification } from '../../../domain/types';
import { identity, type Row } from './columns';

export type NotificationRow = Row<MockNotification, 'sent_at', 'recipient'> & { id: number };

export const NotificationEntity = new EntitySchema<NotificationRow>({
  name: 'MockNotification',
  tableName: 'mock_notifications',
  columns: {
    id: { ...identity, select: false },
    idempotency_key: { type: 'text' },
    claim_id: { type: 'uuid' },
    template: { type: 'text' },
    channel: { type: 'text' },
    recipient: { type: 'jsonb' },
    subject: { type: 'text', nullable: true },
    body: { type: 'text' },
    sent_at: { type: 'timestamptz' },
  },
});
