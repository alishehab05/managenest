import { IsString, Matches } from 'class-validator';

export class UpdateSessionPhoneDto {
  @IsString()
  @Matches(/^(?:\+[1-9]\d{6,14})?$/)
  phoneNumber: string;
}
