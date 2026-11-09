import { IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DRIVER_SPECIALTIES, WORKER_JOB_ROLES } from '../worker-job-roles.js';

export class UpdateWorkerDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  @MinLength(4)
  @MaxLength(64)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  employeeNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:\+[1-9]\d{6,14})?$/)
  phoneNumber?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(/^[a-f\d]{24}$/i, { each: true })
  warehouseIds?: string[];

  @IsOptional()
  @IsIn(WORKER_JOB_ROLES)
  role?: (typeof WORKER_JOB_ROLES)[number];

  @IsOptional()
  @IsArray()
  @IsIn(DRIVER_SPECIALTIES, { each: true })
  specialties?: (typeof DRIVER_SPECIALTIES)[number][];

  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';
}
