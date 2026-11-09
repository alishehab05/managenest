import { IsEmail, MaxLength } from 'class-validator';

export class UpdateSessionEmailDto {
  @IsEmail()
  @MaxLength(254)
  email: string;
}
