import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

export type AccountDocument = HydratedDocument<Account>;

@Schema({ collection: 'accounts', timestamps: true })
export class Account {
  @Prop({ required: true, unique: true, index: true })
  clerkUserId: string;

  @Prop({ type: Types.ObjectId, ref: 'Company', required: true, index: true })
  companyId: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true })
  username: string;

  @Prop({ type: String, default: null, lowercase: true, trim: true })
  email: string | null;

  @Prop({ type: String, default: null, trim: true })
  phoneNumber: string | null;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  employeeNumber: string;

  @Prop({ required: true, default: 'worker' })
  role: string;

  @Prop({ type: [Types.ObjectId], default: [] })
  warehouseIds: Types.ObjectId[];

  @Prop({ type: [String], default: [] })
  specialties: string[];

  @Prop({ default: 'active', enum: ['active', 'suspended', 'deleted'] })
  status: string;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;
}

export const AccountSchema = SchemaFactory.createForClass(Account);
AccountSchema.index(
  { companyId: 1, employeeNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['active', 'suspended'] } },
  },
);
AccountSchema.index(
  { username: 1 },
  { unique: true, partialFilterExpression: { username: { $type: 'string' } } },
);
