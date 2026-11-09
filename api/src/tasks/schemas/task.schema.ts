import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

export type TaskDocument = HydratedDocument<Task>;

@Schema({ collection: 'tasks', timestamps: true })
export class Task {
  @Prop({ type: Types.ObjectId, ref: 'Company', required: true, index: true })
  companyId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Account', required: true, index: true })
  assigneeId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 160 })
  title: string;

  @Prop({ type: String, default: '', trim: true, maxlength: 2000 })
  description: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Truck', default: null })
  truckId: Types.ObjectId | null;

  @Prop({ type: String, default: '', trim: true, maxlength: 500 })
  route: string;

  @Prop({ type: Date, default: null })
  dueAt: Date | null;

  @Prop({ required: true, enum: ['low', 'normal', 'high'], default: 'normal' })
  priority: string;

  @Prop({ required: true, enum: ['open', 'in_progress', 'pending_confirmation', 'completed'], default: 'open', index: true })
  status: string;

  @Prop({ required: true })
  createdByClerkUserId: string;

  @Prop({ type: Date, default: null })
  managerConfirmedAt: Date | null;

  @Prop({ type: Date, default: null })
  workerConfirmedAt: Date | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;
}

export const TaskSchema = SchemaFactory.createForClass(Task);
TaskSchema.index({ companyId: 1, assigneeId: 1, status: 1, createdAt: -1 });
