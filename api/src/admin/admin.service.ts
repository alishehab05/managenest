import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { ClerkUsersService } from '../auth/clerk-users.service.js';
import { CompanyUser } from '../auth/schemas/company-user.schema.js';
import { Account } from '../auth/schemas/account.schema.js';
import { Company } from '../companies/schemas/company.schema.js';
import { CreateManagerDto } from './dto/create-manager.dto.js';
import { UpdateManagerDto } from './dto/update-manager.dto.js';

@Injectable()
export class AdminService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(CompanyUser.name) private readonly users: Model<CompanyUser>,
    @InjectModel(Account.name) private readonly accounts: Model<Account>,
    @InjectModel(Company.name) private readonly companies: Model<Company>,
    private readonly clerk: ClerkUsersService,
  ) {}

  private async requirePlatformAdmin(clerkUserId: string): Promise<void> {
    const admin = await this.users.exists({
      clerkUserId,
      kind: 'platform_admin',
      status: 'active',
    });
    if (!admin) throw new ForbiddenException('Platform administrator access required');
  }

  async listManagers(clerkUserId: string) {
    await this.requirePlatformAdmin(clerkUserId);
    return this.users
      .find({ kind: 'company_manager', status: { $ne: 'deleted' } })
      .populate('companyId', 'name baseCurrencyCode status')
      .select('name username email kind companyId status createdAt')
      .sort({ createdAt: -1 })
      .lean();
  }

  async createManager(clerkUserId: string, input: CreateManagerDto) {
    await this.requirePlatformAdmin(clerkUserId);
    const username = input.username.trim().toLowerCase();
    const existingUsername =
      (await this.users.exists({ username })) ||
      (await this.accounts.exists({ username }));
    if (existingUsername) {
      throw new ConflictException('Username is already in use');
    }

    const { user, initialPassword } = await this.clerk.createManagedUser(
      input.name,
      username,
    );
    const mongoSession = await this.connection.startSession();
    const companyId = new Types.ObjectId();
    const managerId = new Types.ObjectId();
    try {
      await mongoSession.withTransaction(async () => {
        await this.companies.create(
          [{
            _id: companyId,
            name: input.companyName.trim(),
            baseCurrencyCode: input.baseCurrencyCode?.toUpperCase() ?? 'USD',
            managerUserId: managerId,
          }],
          { session: mongoSession },
        );
        await this.users.create(
          [{
            _id: managerId,
            clerkUserId: user.id,
            username,
            email: null,
            name: input.name.trim(),
            kind: 'company_manager',
            companyId,
          }],
          { session: mongoSession },
        );
      });
    } catch (error) {
      await this.clerk.deleteManagedUser(user.id);
      throw error;
    } finally {
      await mongoSession.endSession();
    }

    return {
      manager: {
        id: managerId.toString(),
        name: input.name.trim(),
        username,
        email: null,
        companyName: input.companyName.trim(),
        status: 'active',
      },
      initialPassword,
      passwordNotice: 'Copy this password now. It will not be shown again.',
    };
  }

  async updateManager(
    clerkUserId: string,
    id: string,
    input: UpdateManagerDto,
  ) {
    await this.requirePlatformAdmin(clerkUserId);
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Manager not found');
    const manager = await this.users.findOne({
      _id: id,
      kind: 'company_manager',
      status: { $ne: 'deleted' },
    });
    if (!manager) throw new NotFoundException('Manager not found');

    if (input.username !== undefined && input.username.trim().toLowerCase() !== manager.username) {
      const username = input.username.trim().toLowerCase();
      const duplicate =
        (await this.users.exists({ username, _id: { $ne: manager._id } })) ||
        (await this.accounts.exists({ username }));
      if (duplicate) throw new ConflictException('Username is already in use');
      await this.clerk.updateManagedUser(
        manager.clerkUserId,
        input.name,
        username,
      );
      manager.username = username;
    } else if (input.name !== undefined) {
      await this.clerk.updateManagedUser(manager.clerkUserId, input.name);
    }
    if (input.name !== undefined) {
      manager.name = input.name.trim();
    }
    if (input.companyName !== undefined && manager.companyId) {
      await this.companies.updateOne(
        { _id: manager.companyId },
        { $set: { name: input.companyName.trim() } },
      );
    }
    if (input.status !== undefined && input.status !== manager.status) {
      if (input.status === 'suspended') await this.clerk.ban(manager.clerkUserId);
      else await this.clerk.unban(manager.clerkUserId);
      manager.status = input.status;
    }
    await manager.save();
    return {
      id: manager.id,
      name: manager.name,
      username: manager.username,
      email: manager.email,
      status: manager.status,
    };
  }

  async deleteManager(clerkUserId: string, id: string) {
    await this.requirePlatformAdmin(clerkUserId);
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Manager not found');
    const manager = await this.users.findOne({
      _id: id,
      kind: 'company_manager',
      status: { $ne: 'deleted' },
    });
    if (!manager) throw new NotFoundException('Manager not found');

    await this.clerk.ban(manager.clerkUserId);
    manager.status = 'deleted';
    manager.deletedAt = new Date();
    await manager.save();
    return { id: manager.id, status: 'deleted' };
  }
}
