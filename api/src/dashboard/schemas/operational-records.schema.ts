import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

const objectIdType = MongooseSchema.Types.ObjectId;
const decimalType = MongooseSchema.Types.Decimal128;

@Schema({ collection: 'cocoaLots', timestamps: true })
export class CocoaLot {
  @Prop({ type: objectIdType, ref: 'Company', required: true, index: true })
  companyId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Warehouse', required: true, index: true })
  warehouseId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  lotNumber: string;

  @Prop({ type: decimalType, required: true })
  receivedQuantityKg: Types.Decimal128;

  @Prop({ type: decimalType, required: true })
  remainingQuantityKg: Types.Decimal128;

  @Prop({ type: decimalType, required: true })
  unitCostPerKg: Types.Decimal128;

  @Prop({ type: decimalType, required: true })
  inventoryValue: Types.Decimal128;

  @Prop({ default: 'available', enum: ['available', 'depleted', 'quarantined'] })
  status: string;
}

export const CocoaLotSchema = SchemaFactory.createForClass(CocoaLot);
CocoaLotSchema.index({ companyId: 1, warehouseId: 1, status: 1 });
CocoaLotSchema.index({ companyId: 1, warehouseId: 1, lotNumber: 1 }, { unique: true });

@Schema({ collection: 'stockMovements', timestamps: true })
export class StockMovement {
  @Prop({ type: objectIdType, ref: 'Company', required: true, index: true })
  companyId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Warehouse', required: true, index: true })
  warehouseId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'CocoaLot', required: true, index: true })
  lotId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Warehouse', default: null })
  destinationWarehouseId: Types.ObjectId | null;

  @Prop({ required: true, enum: ['incoming', 'outgoing', 'transfer'] })
  movementType: string;

  @Prop({ type: decimalType, required: true })
  quantityKg: Types.Decimal128;

  @Prop({ type: decimalType, required: true })
  unitCostPerKg: Types.Decimal128;

  @Prop({ type: Date, required: true, default: Date.now, index: true })
  occurredAt: Date;
}

export const StockMovementSchema = SchemaFactory.createForClass(StockMovement);
StockMovementSchema.index({ companyId: 1, warehouseId: 1, occurredAt: -1 });

@Schema({ collection: 'trucks', timestamps: true })
export class Truck {
  @Prop({ type: objectIdType, ref: 'Company', required: true, index: true })
  companyId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Warehouse', required: true, index: true })
  warehouseId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true, uppercase: true })
  registrationNumber: string;

  @Prop({ type: objectIdType, ref: 'Account', default: null, index: true })
  driverId: Types.ObjectId | null;

  @Prop({ type: objectIdType, ref: 'Asset', default: null, index: true })
  assetId: Types.ObjectId | null;

  @Prop({ default: 'active', enum: ['active', 'inactive', 'sold', 'disposed'] })
  status: string;

  @Prop({ type: Date, default: null })
  disposedAt: Date | null;
}

export const TruckSchema = SchemaFactory.createForClass(Truck);
TruckSchema.index({ companyId: 1, registrationNumber: 1 }, { unique: true });
TruckSchema.index({ companyId: 1, warehouseId: 1, status: 1 });

@Schema({ collection: 'trips', timestamps: true })
export class Trip {
  @Prop({ type: objectIdType, ref: 'Company', required: true, index: true })
  companyId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Warehouse', required: true, index: true })
  warehouseId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Truck', required: true, index: true })
  truckId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Account', default: null })
  driverId: Types.ObjectId | null;

  @Prop({ type: objectIdType, ref: 'Sale', default: null, index: true })
  shipmentId: Types.ObjectId | null;

  @Prop({ required: true, enum: ['pending', 'active', 'completed', 'cancelled'] })
  status: string;

  @Prop({ type: decimalType, default: () => Types.Decimal128.fromString('0') })
  transportedQuantityKg: Types.Decimal128;

  @Prop({ type: Date, default: null })
  startedAt: Date | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;
}

export const TripSchema = SchemaFactory.createForClass(Trip);
TripSchema.index({ companyId: 1, warehouseId: 1, status: 1 });
TripSchema.index({ companyId: 1, truckId: 1, status: 1 });

@Schema({ collection: 'expenses', timestamps: true })
export class Expense {
  @Prop({ type: objectIdType, ref: 'Company', required: true, index: true })
  companyId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Warehouse', required: true, index: true })
  warehouseId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Truck', default: null, index: true })
  truckId: Types.ObjectId | null;

  @Prop({ type: objectIdType, ref: 'Trip', default: null, index: true })
  tripId: Types.ObjectId | null;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  category: string;

  @Prop({ required: true, enum: ['warehouse', 'truck', 'trip'] })
  costCenterType: string;

  @Prop({ type: objectIdType, required: true, index: true })
  costCenterId: Types.ObjectId;

  @Prop({ type: decimalType, required: true })
  amount: Types.Decimal128;

  @Prop({ type: decimalType, default: null })
  baseAmount: Types.Decimal128 | null;

  @Prop({ type: decimalType, default: null })
  exchangeRate: Types.Decimal128 | null;

  @Prop({ required: true, uppercase: true, minlength: 3, maxlength: 3 })
  currencyCode: string;

  @Prop({ default: 'unpaid', enum: ['unpaid', 'partial', 'paid'], index: true })
  paymentStatus: string;

  @Prop({ type: Date, required: true, default: Date.now, index: true })
  incurredAt: Date;
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);
ExpenseSchema.index({ companyId: 1, warehouseId: 1, incurredAt: -1 });
ExpenseSchema.index({ companyId: 1, tripId: 1, truckId: 1 });

@Schema({ collection: 'fuelLogs', timestamps: true })
export class FuelLog {
  @Prop({ type: objectIdType, ref: 'Company', required: true, index: true })
  companyId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Warehouse', required: true, index: true })
  warehouseId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Truck', required: true, index: true })
  truckId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Trip', default: null, index: true })
  tripId: Types.ObjectId | null;

  @Prop({ type: objectIdType, ref: 'Expense', default: null, index: true })
  expenseId: Types.ObjectId | null;

  @Prop({ type: decimalType, required: true })
  quantityLiters: Types.Decimal128;

  @Prop({ type: decimalType, required: true })
  unitPrice: Types.Decimal128;

  @Prop({ type: decimalType, default: null })
  baseAmount: Types.Decimal128 | null;

  @Prop({ type: decimalType, default: null })
  exchangeRate: Types.Decimal128 | null;

  @Prop({ required: true, uppercase: true, minlength: 3, maxlength: 3 })
  currencyCode: string;

  @Prop({ type: Date, required: true, default: Date.now, index: true })
  occurredAt: Date;
}

export const FuelLogSchema = SchemaFactory.createForClass(FuelLog);
FuelLogSchema.index({ companyId: 1, warehouseId: 1, truckId: 1, occurredAt: -1 });

@Schema({ collection: 'maintenance', timestamps: true })
export class MaintenanceRecord {
  @Prop({ type: objectIdType, ref: 'Company', required: true, index: true })
  companyId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Warehouse', required: true, index: true })
  warehouseId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Truck', required: true, index: true })
  truckId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Expense', default: null, index: true })
  expenseId: Types.ObjectId | null;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({ default: 'scheduled', enum: ['scheduled', 'in_progress', 'completed', 'cancelled'] })
  status: string;

  @Prop({ type: Date, required: true, default: Date.now, index: true })
  occurredAt: Date;
}

export const MaintenanceRecordSchema = SchemaFactory.createForClass(MaintenanceRecord);
MaintenanceRecordSchema.index({ companyId: 1, warehouseId: 1, truckId: 1, occurredAt: -1 });

@Schema({ collection: 'materials', timestamps: true })
export class Material {
  @Prop({ type: objectIdType, ref: 'Company', required: true, index: true })
  companyId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Warehouse', required: true, index: true })
  warehouseId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: decimalType, required: true })
  quantityOnHand: Types.Decimal128;

  @Prop({ type: decimalType, required: true })
  unitCost: Types.Decimal128;
}

export const MaterialSchema = SchemaFactory.createForClass(Material);
MaterialSchema.index({ companyId: 1, warehouseId: 1 });

@Schema({ collection: 'materialMovements', timestamps: true })
export class MaterialMovement {
  @Prop({ type: objectIdType, ref: 'Company', required: true, index: true })
  companyId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Warehouse', required: true, index: true })
  warehouseId: Types.ObjectId;

  @Prop({ type: objectIdType, ref: 'Material', required: true, index: true })
  materialId: Types.ObjectId;

  @Prop({ required: true, enum: ['incoming', 'consumed', 'transfer'] })
  movementType: string;

  @Prop({ type: decimalType, required: true })
  quantity: Types.Decimal128;

  @Prop({ type: Date, required: true, default: Date.now })
  occurredAt: Date;
}

export const MaterialMovementSchema = SchemaFactory.createForClass(MaterialMovement);
MaterialMovementSchema.index({ companyId: 1, warehouseId: 1, occurredAt: -1 });
