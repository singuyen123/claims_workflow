import { Expose } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

/** Path parameters of /api/claims/:ref/… */
export class ClaimParams {
  /** Claim number (CLM-…) or id. */
  @Expose()
  @IsString()
  @IsNotEmpty()
  ref!: string;
}

/** Path parameters of /api/claims/:ref/transitions/:transition */
export class TransitionParams extends ClaimParams {
  @Expose()
  @IsString()
  @IsNotEmpty()
  transition!: string;
}
