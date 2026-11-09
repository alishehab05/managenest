import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

export type WarehouseDocument = HydratedDocument<Warehouse>;

@Schema({ collection: 'warehouses', timestamps: true })
export class Warehouse {
  @Prop({ type: Types.ObjectId, ref: 'Company', required: true, index: true })
  companyId: Types.ObjectId;

  @Prop({ required: true, uppercase: true, trim: true })
  code: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, trim: true, default: '' })
  location: string;

  @Prop({ type: String, trim: true, default: '' })
  address: string;

  @Prop({ type: MongooseSchema.Types.Decimal128, default: null })
  lowStockThresholdKg: Types.Decimal128 | null;

  @Prop({ default: 'active', enum: ['active', 'inactive', 'archived'] })
  status: string;
}

export const WarehouseSchema = SchemaFactory.createForClass(Warehouse);
WarehouseSchema.index({ companyId: 1, code: 1 }, { unique: true });
