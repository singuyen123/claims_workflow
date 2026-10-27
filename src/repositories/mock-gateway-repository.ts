import type { MockNotification, MockPayment } from '../domain/types';

/**
 * State of the mock payment gateway and notification channel. It lives in the database, so the
 * idempotency guarantees hold even when the CLI and the worker run as separate processes.
 */
export interface MockGatewayRepository {
  /** Consumes one injected failure; returns true when this call should fail. */
  consumeFault(): Promise<boolean>;
  /** Makes the next `count` payment calls fail. */
  setFaults(count: number): Promise<void>;
  /** Records a payment once per idempotency key and returns the payment for that key. */
  recordPayment(payment: MockPayment): Promise<MockPayment & { created: boolean }>;
  listPayments(claimId?: string): Promise<MockPayment[]>;
  /** Records a notification once per idempotency key; false when it was already sent. */
  recordNotification(notification: MockNotification): Promise<boolean>;
  listNotifications(claimId?: string): Promise<MockNotification[]>;
}
