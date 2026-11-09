import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

export type CompanyUserDocument = HydratedDocument<CompanyUser>;

@Schema({ collection: 'users', timestamps: true })
export class CompanyUser {
  @Prop({ required: true, unique: true, index: true })
  clerkUserId: string;

  @Prop({ required: true, lowercase: true, trim: true })
  username: string;

  @Prop({ type: String, default: null, lowercase: true, trim: true })
  email: string | null;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, default: null, trim: true })
  phoneNumber: string | null;

  @Prop({
    required: true,
    enum: ['platform_admin', 'company_manager'],
    default: 'company_manager',
  })
  kind: string;

  @Prop({ type: Types.ObjectId, ref: 'Company', default: null, index: true })
  companyId: Types.ObjectId | null;

  @Prop({ default: 'active', enum: ['active', 'suspended', 'deleted'] })
  status: string;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;
}

export const CompanyUserSchema = SchemaFactory.createForClass(CompanyUser);
CompanyUserSchema.index(
  { username: 1 },
  { unique: true, partialFilterExpression: { username: { $type: 'string' } } },
);
