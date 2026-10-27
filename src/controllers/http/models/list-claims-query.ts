import { Expose, Transform } from 'class-transformer';
import {
  IsBooleanString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const DEFAULT_LIMIT = 100;
const LIMIT_MESSAGE = 'limit must be an integer from 1 to 500';

/** Query string of GET /api/claims?state=A,B&limit=100&queue=1 */
export class ListClaimsQuery {
  /** Only claims in these states: `state=A,B` or `state=A&state=B`; empty means every state. */
  @Expose()
  @Transform(({ value }) => (value === '' ? undefined : String(value).split(',')))
  @IsOptional()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  state?: string[];

  /** Digits only: anything else stays a string and fails `@IsInt`; empty means the default. */
  @Expose()
  @Transform(({ value }) =>
    value === '' ? DEFAULT_LIMIT : /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt({ message: LIMIT_MESSAGE })
  @Min(1, { message: LIMIT_MESSAGE })
  @Max(500, { message: LIMIT_MESSAGE })
  limit = DEFAULT_LIMIT;

  /** `queue=1` or `queue=true`: only claims the acting user can act on now; empty means no. */
  @Expose()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsBooleanString()
  queue?: string;
}
