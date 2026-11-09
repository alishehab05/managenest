import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateCompanyPreferencesDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  baseCurrencyCode?: string;
}
