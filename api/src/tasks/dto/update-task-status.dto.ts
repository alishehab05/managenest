import { IsIn } from 'class-validator';

export class UpdateTaskStatusDto {
  @IsIn(['open', 'in_progress', 'completed'])
  status: 'open' | 'in_progress' | 'completed';
}
