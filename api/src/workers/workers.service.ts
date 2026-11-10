import {
  BadRequestException,
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
      .select('name username email phoneNumber employeeNumber role status warehouseIds specialty createdAt')
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
    const role = input.role?.trim() || 'worker';
    if (role === 'driver' && input.warehouseIds?.length) {
      throw new BadRequestException('Driver warehouse access is assigned from the driver’s truck');
    }
    const warehouseIds = role === 'driver'
      ? []
      : await this.validateWarehouseIds(companyId, input.warehouseIds ?? []);

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
        role,
        warehouseIds,
        specialty: role === 'driver' ? input.specialty ?? null : null,
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
          specialty: account.specialty,
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
    if (!manager.companyId) {
      throw new ForbiddenException('Active company manager access required');
    }
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Worker not found');
    const worker = await this.accounts.findOne({
      _id: id,
      companyId: manager.companyId,
      status: { $ne: 'deleted' },
    });
    if (!worker) throw new NotFoundException('Worker not found');

    const nextRole = input.role?.trim() ?? worker.role;
    if (nextRole === 'driver' && input.warehouseIds?.length) {
      throw new BadRequestException('Driver warehouse access is assigned from the driver’s truck');
    }
    if (worker.role === 'driver' && nextRole !== 'driver') {
      const assignedTruck = await this.accounts.db.collection('trucks').findOne({
        companyId: manager.companyId,
        driverId: worker._id,
        status: 'active',
      }, { projection: { _id: 1 } });
      if (assignedTruck) {
        throw new ConflictException('Reassign this driver from active trucks before changing their role');
      }
    }

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
    if (nextRole === 'driver') {
      worker.warehouseIds = await this.getDriverWarehouseIds(manager.companyId, worker._id);
    } else if (input.warehouseIds !== undefined) {
      worker.warehouseIds = await this.validateWarehouseIds(
        manager.companyId,
        input.warehouseIds,
      );
    } else if (worker.role === 'driver') {
      worker.warehouseIds = [];
    }
    if (input.role !== undefined) worker.role = nextRole;
    if (input.specialty !== undefined) {
      worker.specialty = worker.role === 'driver' ? input.specialty : null;
    } else if (input.role !== undefined && worker.role !== 'driver') {
      worker.specialty = null;
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
      specialty: worker.specialty,
    };
  }

  private async validateWarehouseIds(
    companyId: Types.ObjectId,
    warehouseIdsInput: string[],
  ) {
    const warehouseIds = [...new Set(warehouseIdsInput)];
    if (warehouseIds.length === 0) return [];

    const validWarehouses = await this.accounts.db
      .collection('warehouses')
      .countDocuments({
        _id: { $in: warehouseIds.map((warehouseId) => new Types.ObjectId(warehouseId)) },
        companyId,
        status: 'active',
      });
    if (validWarehouses !== warehouseIds.length) {
      throw new NotFoundException('One or more warehouses were not found in this company');
    }

    return warehouseIds.map((warehouseId) => new Types.ObjectId(warehouseId));
  }

  private async getDriverWarehouseIds(
    companyId: Types.ObjectId,
    driverId: Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    const trucks = await this.accounts.db.collection('trucks')
      .find(
        { companyId, driverId, status: 'active' },
        { projection: { warehouseId: 1 } },
      )
      .toArray();
    return [
      ...new Map(
        trucks
          .filter((truck) => truck.warehouseId instanceof Types.ObjectId)
          .map((truck) => [truck.warehouseId.toString(), truck.warehouseId]),
      ).values(),
    ];
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
    const assignedTruck = await this.accounts.db.collection('trucks').findOne({
      companyId: manager.companyId,
      driverId: worker._id,
      status: 'active',
    }, { projection: { _id: 1 } });
    if (assignedTruck) {
      throw new ConflictException('Reassign this driver from active trucks before deleting the account');
    }

    await this.clerk.ban(worker.clerkUserId);
    worker.status = 'deleted';
    worker.deletedAt = new Date();
    await worker.save();
    return { id: worker.id, status: 'deleted' };
  }
}
