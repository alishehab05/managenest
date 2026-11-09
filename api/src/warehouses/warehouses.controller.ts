import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { getClerkUserId } from '../auth/clerk-auth.guard.js';
import { CreateWarehouseDto } from './dto/create-warehouse.dto.js';
import { WarehousesService } from './warehouses.service.js';

@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  list(@Req() request: Request) {
    return this.warehouses.listForUser(getClerkUserId(request));
  }

  @Post()
  create(@Req() request: Request, @Body() input: CreateWarehouseDto) {
    return this.warehouses.createForUser(getClerkUserId(request), input);
  }
}
