import {
  IsOptional,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateManagerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  @MinLength(4)
  @MaxLength(64)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  companyName: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  @MinLength(3)
  @MaxLength(3)
  baseCurrencyCode?: string;
}
