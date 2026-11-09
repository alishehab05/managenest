import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClerkUsersService } from './clerk-users.service.js';
import { SessionController } from './session.controller.js';
import { SessionService } from './session.service.js';
import { Account, AccountSchema } from './schemas/account.schema.js';
import {
  CompanyUser,
  CompanyUserSchema,
} from './schemas/company-user.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CompanyUser.name, schema: CompanyUserSchema },
      { name: Account.name, schema: AccountSchema },
    ]),
  ],
  controllers: [SessionController],
  providers: [SessionService, ClerkUsersService],
  exports: [SessionService, ClerkUsersService],
})
export class AuthModule {}
