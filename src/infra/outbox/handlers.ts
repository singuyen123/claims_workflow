import type pg from 'pg';
import type { OutboxMessage } from '../../domain/types';
import { sha256Hex } from '../../engine/hash';
import { formatMoney, maskValue } from '../../engine/templates';
import { consumeFault, recordNotification, recordPayment } from '../repos/mock';

export interface HandlerContext {
  db: pg.Pool;
  now: Date;
  log: (line: string) => void;
}

export type Handler = (
  message: OutboxMessage,
  ctx: HandlerContext,
) => Promise<Record<string, unknown>>;

/** Recipient for console output; member ids are masked. */
export function describeRecipient(to: unknown): string {
  const r = (to ?? {}) as Record<string, unknown>;
  if (r.kind === 'member') return `member ${maskValue(String(r.member_id ?? ''))}`;
  if (r.kind === 'role') return `role ${String(r.role)}`;
  return `user ${String(r.user_id ?? '?')}`;
}

// Console output never includes notification bodies: they can carry medical details, which are
// sensitive personal data. The full text is kept in mock_notifications (the "sent mail" box).
const notify: Handler = async (m, { db, now, log }) => {
  const p = m.payload;
  const inserted = await recordNotification(db, {
    idempotency_key: m.idempotency_key,
    claim_id: m.claim_id,
    template: String(p.template),
    channel: String(p.channel),
    recipient: (p.to ?? {}) as Record<string, unknown>,
    subject: (p.subject as string | null) ?? null,
    body: String(p.body),
    sent_at: now.toISOString(),
  });
  log(
    `[notify] ${p.claim_no} ${p.template} → ${describeRecipient(p.to)} via ${p.channel}: "${p.subject ?? ''}"${inserted ? '' : ' (already sent)'}`,
  );
  return { delivered: true, duplicate: !inserted };
};

const triggerPayment: Handler = async (m, { db, now, log }) => {
  const p = m.payload;
  if (await consumeFault(db)) {
    throw new Error('mock payment gateway unavailable (injected fault)');
  }
  const gatewayRef = `MOCKPAY-${sha256Hex(m.idempotency_key).slice(0, 10).toUpperCase()}`;
  const payment = await recordPayment(db, {
    idempotency_key: m.idempotency_key,
    claim_id: m.claim_id,
    amount: Number(p.amount),
    reference: String(p.reference),
    gateway_ref: gatewayRef,
    created_at: now.toISOString(),
  });
  log(
    `[payment] ${p.claim_no} ${formatMoney(Number(p.amount))} → ${payment.gateway_ref}${payment.created ? '' : ' (already paid: same idempotency key)'}`,
  );
  return { gateway_ref: payment.gateway_ref, duplicate: !payment.created };
};

const logEffect: Handler = async (m, { log }) => {
  log(`[log] ${m.payload.message}`);
  return { logged: true };
};

export const HANDLERS: Record<OutboxMessage['effect_type'], Handler> = {
  notify,
  trigger_payment: triggerPayment,
  log: logEffect,
};
