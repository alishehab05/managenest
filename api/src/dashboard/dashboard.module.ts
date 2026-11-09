import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import {
  CocoaLot,
  CocoaLotSchema,
  Expense,
  ExpenseSchema,
  FuelLog,
  FuelLogSchema,
  Material,
  MaterialMovement,
  MaterialMovementSchema,
  MaterialSchema,
  MaintenanceRecord,
  MaintenanceRecordSchema,
  StockMovement,
  StockMovementSchema,
  Trip,
  TripSchema,
  Truck,
  TruckSchema,
} from './schemas/operational-records.schema.js';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  imports: [
    CompaniesModule,
    MongooseModule.forFeature([
      { name: CocoaLot.name, schema: CocoaLotSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: Truck.name, schema: TruckSchema },
      { name: Trip.name, schema: TripSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: FuelLog.name, schema: FuelLogSchema },
      { name: MaintenanceRecord.name, schema: MaintenanceRecordSchema },
      { name: Material.name, schema: MaterialSchema },
      { name: MaterialMovement.name, schema: MaterialMovementSchema },
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
