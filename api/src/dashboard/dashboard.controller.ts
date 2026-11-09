import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { getClerkUserId } from '../auth/clerk-auth.guard.js';
import { ModuleRecordDto } from './dto/module-record.dto.js';
import { TransferTruckDto } from './dto/transfer-truck.dto.js';
import { UpdateCompanyPreferencesDto } from './dto/update-company-preferences.dto.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('company')
  company(@Req() request: Request) {
    return this.dashboard.getCompanyDashboard(getClerkUserId(request));
  }

  @Get('expenses')
  expenses(
    @Req() request: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
    @Query('truckId') truckId?: string,
    @Query('tripId') tripId?: string,
    @Query('paymentStatus') paymentStatus?: string,
  ) {
    return this.dashboard.getCompanyExpenses(getClerkUserId(request), {
      from,
      to,
      category,
      truckId,
      tripId,
      paymentStatus,
    });
  }

  @Get('modules/:collection')
  moduleRecords(
    @Req() request: Request,
    @Param('collection') collection: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('page') page?: string,
  ) {
    return this.dashboard.getCompanyModuleRecords(
      getClerkUserId(request),
      collection,
      warehouseId,
      page === undefined ? 1 : Number(page),
    );
  }

  @Patch('company/preferences')
  updateCompanyPreferences(
    @Req() request: Request,
    @Body() input: UpdateCompanyPreferencesDto,
  ) {
    return this.dashboard.updateCompanyPreferences(
      getClerkUserId(request),
      { ...input },
    );
  }

  @Get('company/module-options/:collection')
  moduleOptions(
    @Req() request: Request,
    @Param('collection') collection: string,
  ) {
    return this.dashboard.getCompanyModuleOptions(
      getClerkUserId(request),
      collection,
    );
  }

  @Get('warehouses/:warehouseId/modules/:collection')
  warehouseModuleRecords(
    @Req() request: Request,
    @Param('warehouseId') warehouseId: string,
    @Param('collection') collection: string,
    @Query('page') page?: string,
  ) {
    return this.dashboard.getWarehouseModuleRecords(
      getClerkUserId(request),
      warehouseId,
      collection,
      page === undefined ? 1 : Number(page),
    );
  }

  @Post('modules/:collection')
  createModuleRecord(
    @Req() request: Request,
    @Param('collection') collection: string,
    @Query('warehouseId') warehouseId: string | undefined,
    @Body() input: ModuleRecordDto,
  ) {
    return this.dashboard.createCompanyModuleRecord(
      getClerkUserId(request),
      collection,
      input.record,
      warehouseId,
    );
  }

  @Patch('modules/:collection/:id')
  updateModuleRecord(
    @Req() request: Request,
    @Param('collection') collection: string,
    @Param('id') id: string,
    @Query('warehouseId') warehouseId: string | undefined,
    @Body() input: ModuleRecordDto,
  ) {
    return this.dashboard.updateCompanyModuleRecord(
      getClerkUserId(request),
      collection,
      id,
      input.record,
      warehouseId,
    );
  }

  @Delete('modules/:collection/:id')
  deleteModuleRecord(
    @Req() request: Request,
    @Param('collection') collection: string,
    @Param('id') id: string,
    @Query('warehouseId') warehouseId: string | undefined,
  ) {
    return this.dashboard.deleteCompanyModuleRecord(
      getClerkUserId(request),
      collection,
      id,
      warehouseId,
    );
  }

  @Get('warehouses/:id')
  warehouse(
    @Req() request: Request,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
    @Query('truckId') truckId?: string,
    @Query('tripId') tripId?: string,
    @Query('paymentStatus') paymentStatus?: string,
  ) {
    return this.dashboard.getWarehouseOverview(getClerkUserId(request), id, {
      from,
      to,
      category,
      truckId,
      tripId,
      paymentStatus,
    });
  }

  @Post('trucks/:truckId/transfer')
  transferTruck(
    @Req() request: Request,
    @Param('truckId') truckId: string,
    @Body() input: TransferTruckDto,
  ) {
    return this.dashboard.transferTruck(
      getClerkUserId(request),
      truckId,
      input.warehouseId,
    );
  }
}
