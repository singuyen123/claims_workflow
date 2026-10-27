import { Expose } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

const NAME_THE_USER = 'X-User-Id must name the acting user';

/**
 * Demo authentication: the caller names the acting user (and optionally the role) in headers.
 * A real deployment would take both from a verified identity token instead.
 */
export class ActorHeaders {
  @Expose({ name: 'x-user-id' })
  @IsString({ message: NAME_THE_USER })
  @IsNotEmpty({ message: NAME_THE_USER })
  user_id!: string;

  /** The role to act in, for users holding several; empty means any of them. */
  @Expose({ name: 'x-role' })
  @IsOptional()
  @IsString()
  role?: string;
}
