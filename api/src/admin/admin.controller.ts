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
import { CreateManagerDto } from './dto/create-manager.dto.js';
import { UpdateManagerDto } from './dto/update-manager.dto.js';
import { AdminService } from './admin.service.js';

@Controller('admin/managers')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  list(@Req() request: Request) {
    return this.admin.listManagers(getClerkUserId(request));
  }

  @Post()
  create(@Req() request: Request, @Body() input: CreateManagerDto) {
    return this.admin.createManager(getClerkUserId(request), input);
  }

  @Patch(':id')
  update(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() input: UpdateManagerDto,
  ) {
    return this.admin.updateManager(getClerkUserId(request), id, input);
  }

  @Delete(':id')
  remove(@Req() request: Request, @Param('id') id: string) {
    return this.admin.deleteManager(getClerkUserId(request), id);
  }
}
