import { Expose } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

/** The Idempotency-Key header; it wins over `idempotency_key` in the body. */
export class IdempotencyHeaders {
  @Expose({ name: 'idempotency-key' })
  @IsOptional()
  @IsString()
  idempotency_key?: string;
}
