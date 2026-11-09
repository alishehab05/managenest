import { IsObject } from 'class-validator';

export class ModuleRecordDto {
  @IsObject()
  record: Record<string, unknown>;
}
