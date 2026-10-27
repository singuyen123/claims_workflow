// TypeORM mappings of the tables, one file per table. Property names are the column names
// (snake_case, like the domain types). Only columns are declared: constraints, indexes, triggers
// and grants live in the migrations (src/infra/db/migrations), so never derive migrations from
// these schemas.
import { AuditEntity } from './audit-entry';
import { ClaimEntity } from './claim';
import { DeniedEntity } from './denied-attempt';
import { IdempotencyEntity } from './idempotency-key';
import { FaultEntity } from './mock-gateway-fault';
import { PaymentEntity } from './mock-gateway-payment';
import { NotificationEntity } from './mock-notification';
import { OutboxEntity } from './outbox-message';
import { PolicyEntity } from './policy';
import { UserEntity } from './user';
import { DefinitionEntity } from './workflow-definition';

export const ENTITIES = [
  DefinitionEntity,
  UserEntity,
  PolicyEntity,
  ClaimEntity,
  AuditEntity,
  DeniedEntity,
  OutboxEntity,
  IdempotencyEntity,
  PaymentEntity,
  FaultEntity,
  NotificationEntity,
];
