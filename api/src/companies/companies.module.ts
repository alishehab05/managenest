import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CompanyUser, CompanyUserSchema } from '../auth/schemas/company-user.schema.js';
import { CompaniesService } from './companies.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CompanyUser.name, schema: CompanyUserSchema },
    ]),
  ],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
