import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Account, AccountSchema } from '../auth/schemas/account.schema.js';
import { CompanyUser, CompanyUserSchema } from '../auth/schemas/company-user.schema.js';
import { Truck, TruckSchema } from '../dashboard/schemas/operational-records.schema.js';
import { Task, TaskSchema } from './schemas/task.schema.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: Account.name, schema: AccountSchema },
      { name: CompanyUser.name, schema: CompanyUserSchema },
      { name: Truck.name, schema: TruckSchema },
    ]),
  ],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
