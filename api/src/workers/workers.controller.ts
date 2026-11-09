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
import { CreateWorkerDto } from './dto/create-worker.dto.js';
import { UpdateWorkerDto } from './dto/update-worker.dto.js';
import { WorkersService } from './workers.service.js';

@Controller('workers')
export class WorkersController {
  constructor(private readonly workers: WorkersService) {}

  @Get()
  list(@Req() request: Request) {
    return this.workers.list(getClerkUserId(request));
  }

  @Post()
  create(@Req() request: Request, @Body() input: CreateWorkerDto) {
    return this.workers.create(getClerkUserId(request), input);
  }

  @Patch(':id')
  update(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() input: UpdateWorkerDto,
  ) {
    return this.workers.update(getClerkUserId(request), id, input);
  }

  @Delete(':id')
  remove(@Req() request: Request, @Param('id') id: string) {
    return this.workers.remove(getClerkUserId(request), id);
  }
}
