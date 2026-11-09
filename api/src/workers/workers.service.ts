import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ClerkUsersService } from '../auth/clerk-users.service.js';
import { Account } from '../auth/schemas/account.schema.js';
import { CompanyUser } from '../auth/schemas/company-user.schema.js';
import { CreateWorkerDto } from './dto/create-worker.dto.js';
import { UpdateWorkerDto } from './dto/update-worker.dto.js';

@Injectable()
export class WorkersService {
  constructor(
    @InjectModel(Account.name) private readonly accounts: Model<Account>,
    @InjectModel(CompanyUser.name) private readonly users: Model<CompanyUser>,
    private readonly clerk: ClerkUsersService,
  ) {}

  private async requireManager(clerkUserId: string) {
    const manager = await this.users.findOne({
      clerkUserId,
      kind: 'company_manager',
      status: 'active',
    });
    if (!manager?.companyId) {
      throw new ForbiddenException('Active company manager access required');
    }
    return manager;
  }

  async list(clerkUserId: string) {
    const manager = await this.requireManager(clerkUserId);
    const companyId = manager.companyId;
    return this.accounts
      .find({ companyId, status: { $ne: 'deleted' } })
      .select('name username email phoneNumber employeeNumber role status warehouseIds specialties createdAt')
      .sort({ name: 1 })
      .lean();
  }

  async create(clerkUserId: string, input: CreateWorkerDto) {
    const manager = await this.requireManager(clerkUserId);
    const companyId = manager.companyId;
    if (!companyId) {
      throw new ForbiddenException('Active company manager access required');
    }
    const username = input.username.trim().toLowerCase();
    const duplicateUsername = await this.users.exists({ username })
      || await this.accounts.exists({ username });
    const duplicateEmployee = await this.accounts.exists({
      companyId: manager.companyId,
      employeeNumber: input.employeeNumber.trim(),
      status: { $ne: 'deleted' },
    });
    if (duplicateUsername || duplicateEmployee) {
      throw new ConflictException('Username or employee number is already in use');
    }

    const { user, initialPassword } = await this.clerk.createManagedUser(
      input.name,
      username,
      input.phoneNumber,
    );
    try {
      const account = await this.accounts.create({
        clerkUserId: user.id,
        companyId,
        username,
        email: null,
        phoneNumber: input.phoneNumber,
        name: input.name.trim(),
        employeeNumber: input.employeeNumber.trim(),
        role: input.role?.trim() || 'worker',
        specialties: input.role === 'driver' ? input.specialties ?? [] : [],
      });
      return {
        worker: {
          id: account.id,
          name: account.name,
          username: account.username,
          phoneNumber: account.phoneNumber,
          email: account.email,
          employeeNumber: account.employeeNumber,
          role: account.role,
          status: account.status,
          warehouseIds: account.warehouseIds,
          specialties: account.specialties,
        },
        initialPassword,
        passwordNotice: 'Copy this password now. It will not be shown again.',
      };
    } catch (error) {
      await this.clerk.deleteManagedUser(user.id);
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new ConflictException('Email or employee number is already in use');
      }
      throw error;
    }
  }

  async update(clerkUserId: string, id: string, input: UpdateWorkerDto) {
    const manager = await this.requireManager(clerkUserId);
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Worker not found');
    const worker = await this.accounts.findOne({
      _id: id,
      companyId: manager.companyId,
      status: { $ne: 'deleted' },
    });
    if (!worker) throw new NotFoundException('Worker not found');

    if (input.username !== undefined && input.username.trim().toLowerCase() !== worker.username) {
      const username = input.username.trim().toLowerCase();
      const duplicate =
        (await this.accounts.exists({ username, _id: { $ne: worker._id } })) ||
        (await this.users.exists({ username }));
      if (duplicate) throw new ConflictException('Username is already in use');
      await this.clerk.updateManagedUser(
        worker.clerkUserId,
        input.name,
        username,
      );
      worker.username = username;
    } else if (input.name !== undefined && input.name.trim() !== worker.name) {
      await this.clerk.updateManagedUser(worker.clerkUserId, input.name);
    }
    if (input.name !== undefined) {
      worker.name = input.name.trim();
    }
    if (input.employeeNumber !== undefined) {
      worker.employeeNumber = input.employeeNumber.trim();
    }
    if (input.phoneNumber !== undefined) worker.phoneNumber = input.phoneNumber.trim() || null;
    if (input.warehouseIds !== undefined) {
      const warehouseIds = [...new Set(input.warehouseIds)];
      const validWarehouses = await this.accounts.db
        .collection('warehouses')
        .countDocuments({
          _id: { $in: warehouseIds.map((warehouseId) => new Types.ObjectId(warehouseId)) },
          companyId: manager.companyId,
        });
      if (validWarehouses !== warehouseIds.length) {
        throw new NotFoundException('One or more warehouses were not found in this company');
      }
      worker.warehouseIds = warehouseIds.map((warehouseId) => new Types.ObjectId(warehouseId));
    }
    if (input.role !== undefined) worker.role = input.role.trim();
    if (input.specialties !== undefined) {
      worker.specialties = worker.role === 'driver' ? input.specialties : [];
    } else if (input.role !== undefined && worker.role !== 'driver') {
      worker.specialties = [];
    }
    if (input.status !== undefined && input.status !== worker.status) {
      if (input.status === 'suspended') await this.clerk.ban(worker.clerkUserId);
      else await this.clerk.unban(worker.clerkUserId);
      worker.status = input.status;
    }
    await worker.save();
    return {
      id: worker.id,
      name: worker.name,
      username: worker.username,
      email: worker.email,
      phoneNumber: worker.phoneNumber,
      employeeNumber: worker.employeeNumber,
      role: worker.role,
      status: worker.status,
      warehouseIds: worker.warehouseIds,
      specialties: worker.specialties,
    };
  }

  async remove(clerkUserId: string, id: string) {
    const manager = await this.requireManager(clerkUserId);
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Worker not found');
    const worker = await this.accounts.findOne({
      _id: id,
      companyId: manager.companyId,
      status: { $ne: 'deleted' },
    });
    if (!worker) throw new NotFoundException('Worker not found');

    await this.clerk.ban(worker.clerkUserId);
    worker.status = 'deleted';
    worker.deletedAt = new Date();
    await worker.save();
    return { id: worker.id, status: 'deleted' };
  }
}
