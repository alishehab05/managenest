import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

export type CompanyDocument = HydratedDocument<Company>;

@Schema({ collection: 'companies', timestamps: true })
export class Company {
  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ required: true, uppercase: true, minlength: 3, maxlength: 3 })
  baseCurrencyCode: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  managerUserId: Types.ObjectId;

  @Prop({ default: 'active', enum: ['active', 'suspended'] })
  status: string;
}

export const CompanySchema = SchemaFactory.createForClass(Company);
