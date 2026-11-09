import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { CompanyUser, CompanyUserSchema } from '../auth/schemas/company-user.schema.js';
import { Account, AccountSchema } from '../auth/schemas/account.schema.js';
import { Company, CompanySchema } from '../companies/schemas/company.schema.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: CompanyUser.name, schema: CompanyUserSchema },
      { name: Account.name, schema: AccountSchema },
      { name: Company.name, schema: CompanySchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
