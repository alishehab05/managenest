import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { CompanyUser } from '../auth/schemas/company-user.schema.js';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectModel(CompanyUser.name) private readonly users: Model<CompanyUser>,
  ) {}

  async requireCompanyId(clerkUserId: string): Promise<string> {
    const manager = await this.users
      .findOne({ clerkUserId, kind: 'company_manager', status: 'active' })
      .select('companyId')
      .lean();
    if (manager?.companyId) return manager.companyId.toString();
    throw new NotFoundException('No active company membership found');
  }
}
