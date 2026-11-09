import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { getClerkUserId } from '../auth/clerk-auth.guard.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { TasksService } from './tasks.service.js';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@Req() request: Request) {
    return this.tasks.list(getClerkUserId(request));
  }

  @Post()
  create(@Req() request: Request, @Body() input: CreateTaskDto) {
    return this.tasks.create(getClerkUserId(request), input);
  }

  @Patch(':id')
  update(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() input: UpdateTaskDto,
  ) {
    return this.tasks.update(getClerkUserId(request), id, input);
  }

  @Patch(':id/status')
  updateOwnStatus(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() input: UpdateTaskStatusDto,
  ) {
    return this.tasks.updateOwnStatus(getClerkUserId(request), id, input.status);
  }

  @Delete(':id')
  remove(@Req() request: Request, @Param('id') id: string) {
    return this.tasks.remove(getClerkUserId(request), id);
  }
}
