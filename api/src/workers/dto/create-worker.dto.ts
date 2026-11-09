import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DRIVER_SPECIALTIES, WORKER_JOB_ROLES } from '../worker-job-roles.js';

export class CreateWorkerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/)
  phoneNumber: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  @MinLength(4)
  @MaxLength(64)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  employeeNumber: string;

  @IsString()
  @IsIn(WORKER_JOB_ROLES)
  role: (typeof WORKER_JOB_ROLES)[number];

  @IsOptional()
  @IsArray()
  @IsIn(DRIVER_SPECIALTIES, { each: true })
  specialties?: (typeof DRIVER_SPECIALTIES)[number][];
}
