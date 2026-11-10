import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Account } from './schemas/account.schema.js';
import { CompanyUser } from './schemas/company-user.schema.js';
import { ClerkUsersService } from './clerk-users.service.js';

@Injectable()
export class SessionService {
  constructor(
    @InjectModel(CompanyUser.name)
    private readonly users: Model<CompanyUser>,
    @InjectModel(Account.name)
    private readonly accounts: Model<Account>,
    private readonly clerk: ClerkUsersService,
  ) {}

  async getForClerkUser(clerkUserId: string) {
    const manager = await this.users
      .findOne({ clerkUserId, status: 'active' })
      .populate('companyId', 'name status baseCurrencyId')
      .lean();
    if (manager) {
      return { kind: manager.kind, profile: manager };
    }

    const account = await this.accounts
      .findOne({ clerkUserId, status: 'active' })
      .select('-specialties')
      .populate('companyId', 'name status baseCurrencyId')
      .lean();
    if (account) {
      return { kind: 'worker', profile: account };
    }

    throw new NotFoundException('No company account is linked to this Clerk user');
  }

  async updateVerifiedEmail(clerkUserId: string, inputEmail: string) {
    const email = inputEmail.trim().toLowerCase();
    if (!(await this.clerk.hasVerifiedEmail(clerkUserId, email))) {
      throw new UnauthorizedException('Verify this email with Clerk before saving it');
    }

    const duplicate =
      (await this.users.exists({ email, clerkUserId: { $ne: clerkUserId } })) ||
      (await this.accounts.exists({ email, clerkUserId: { $ne: clerkUserId } }));
    if (duplicate) throw new ConflictException('Email is already linked to another account');

    const manager = await this.users.findOneAndUpdate(
      { clerkUserId, status: 'active' },
      { $set: { email } },
      { new: true },
    );
    if (manager) return { email: manager.email };

    const worker = await this.accounts.findOneAndUpdate(
      { clerkUserId, status: 'active' },
      { $set: { email } },
      { new: true },
    );
    if (worker) return { email: worker.email };
    throw new NotFoundException('No active account is linked to this Clerk user');
  }

  async updatePhoneNumber(clerkUserId: string, phoneNumberInput: string) {
    const phoneNumber = phoneNumberInput.trim();
    const manager = await this.users.findOneAndUpdate(
      { clerkUserId, kind: 'company_manager', status: 'active' },
      { $set: { phoneNumber: phoneNumber || null } },
      { new: true },
    );
    if (!manager) {
      throw new UnauthorizedException('Only a company manager can update this company contact number');
    }
    return { phoneNumber: manager.phoneNumber };
  }
}
