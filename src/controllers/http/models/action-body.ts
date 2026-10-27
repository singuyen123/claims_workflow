import { IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

/** Body of POST /api/claims and of POST /api/claims/:ref/transitions/:transition. */
export class ActionBody {
  /** Transition input; the workflow config declares and checks its fields. */
  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;

  /** Refuse the action if the claim has moved past this version. */
  @IsOptional()
  @IsInt()
  @Min(1)
  expected_version?: number;

  @IsOptional()
  @IsString()
  idempotency_key?: string;
}
