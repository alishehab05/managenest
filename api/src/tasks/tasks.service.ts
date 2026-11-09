import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Account } from '../auth/schemas/account.schema.js';
import { CompanyUser } from '../auth/schemas/company-user.schema.js';
import { Truck } from '../dashboard/schemas/operational-records.schema.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { Task } from './schemas/task.schema.js';

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    @InjectModel(Account.name) private readonly accounts: Model<Account>,
    @InjectModel(CompanyUser.name) private readonly users: Model<CompanyUser>,
    @InjectModel(Truck.name) private readonly trucks: Model<Truck>,
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

  private async requireWorker(clerkUserId: string) {
    const worker = await this.accounts.findOne({
      clerkUserId,
      status: 'active',
    });
    if (!worker) throw new ForbiddenException('Active worker access required');
    return worker;
  }

  private async requireAssignee(companyId: Types.ObjectId, assigneeId: string) {
    if (!Types.ObjectId.isValid(assigneeId)) {
      throw new BadRequestException('Select a valid worker');
    }
    const worker = await this.accounts.findOne({
      _id: assigneeId,
      companyId,
      status: 'active',
    });
    if (!worker) {
      throw new BadRequestException('Tasks can only be assigned to an active worker in your company');
    }
    return worker;
  }

  async list(clerkUserId: string) {
    const manager = await this.users.findOne({
      clerkUserId,
      kind: 'company_manager',
      status: 'active',
    });
    if (manager?.companyId) {
      return this.tasks
        .find({ companyId: manager.companyId })
        .populate('assigneeId', 'name employeeNumber role')
        .populate('truckId', 'name registrationNumber')
        .sort({ createdAt: -1 })
        .lean();
    }

    const worker = await this.requireWorker(clerkUserId);
    return this.tasks
      .find({ companyId: worker.companyId, assigneeId: worker._id })
      .populate('truckId', 'name registrationNumber')
      .sort({ createdAt: -1 })
      .lean();
  }

  async create(clerkUserId: string, input: CreateTaskDto) {
    const manager = await this.requireManager(clerkUserId);
    const companyId = manager.companyId;
    if (!companyId) {
      throw new ForbiddenException('Active company manager access required');
    }
    const assignee = await this.requireAssignee(companyId, input.assigneeId);
    if ((input.truckId || input.route?.trim()) && assignee.role !== 'driver') {
      throw new BadRequestException('Truck and route assignments are only available for drivers');
    }
    const truckId = input.truckId
      ? await this.requireActiveTruck(companyId, input.truckId)
      : null;
    const dueAt = this.parseDueAt(input.dueAt);
    return this.tasks.create({
      companyId,
      assigneeId: new Types.ObjectId(input.assigneeId),
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      truckId,
      route: input.route?.trim() ?? '',
      dueAt,
      priority: input.priority ?? 'normal',
      createdByClerkUserId: clerkUserId,
    });
  }

  async update(clerkUserId: string, id: string, input: UpdateTaskDto) {
    const manager = await this.requireManager(clerkUserId);
    const companyId = manager.companyId;
    if (!companyId) {
      throw new ForbiddenException('Active company manager access required');
    }
    const task = await this.findTask(companyId, id);
    let assignee: Account | null = null;
    if (input.assigneeId !== undefined) {
      assignee = await this.requireAssignee(companyId, input.assigneeId);
      task.assigneeId = new Types.ObjectId(input.assigneeId);
    }
    if (input.truckId !== undefined || input.route !== undefined || input.assigneeId !== undefined) {
      assignee ??= await this.requireAssignee(companyId, task.assigneeId.toString());
      const nextTruckId = input.truckId === undefined
        ? task.truckId
        : input.truckId
          ? await this.requireActiveTruck(companyId, input.truckId)
          : null;
      const nextRoute = input.route === undefined ? task.route : input.route?.trim() ?? '';
      if ((nextTruckId || nextRoute) && assignee.role !== 'driver') {
        throw new BadRequestException('Truck and route assignments are only available for drivers');
      }
      task.truckId = nextTruckId;
      task.route = nextRoute;
    }
    if (input.title !== undefined) task.title = input.title.trim();
    if (input.description !== undefined) task.description = input.description.trim();
    if (input.dueAt !== undefined) task.dueAt = this.parseDueAt(input.dueAt);
    if (input.priority !== undefined) task.priority = input.priority;
    if (input.status !== undefined) this.setStatus(task, input.status, 'manager');
    await task.save();
    return task;
  }

  async updateOwnStatus(clerkUserId: string, id: string, status: string) {
    const worker = await this.requireWorker(clerkUserId);
    const task = await this.findTask(worker.companyId, id, worker._id);
    this.setStatus(task, status, 'worker');
    await task.save();
    return task;
  }

  async remove(clerkUserId: string, id: string) {
    const manager = await this.requireManager(clerkUserId);
    const companyId = manager.companyId;
    if (!companyId) {
      throw new ForbiddenException('Active company manager access required');
    }
    const task = await this.findTask(companyId, id);
    await task.deleteOne();
    return { id: task.id, status: 'deleted' };
  }

  private async findTask(
    companyId: Types.ObjectId,
    id: string,
    assigneeId?: Types.ObjectId,
  ) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Task not found');
    const task = await this.tasks.findOne({
      _id: id,
      companyId,
      ...(assigneeId ? { assigneeId } : {}),
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  private async requireActiveTruck(companyId: Types.ObjectId, truckId: string) {
    if (!Types.ObjectId.isValid(truckId)) {
      throw new BadRequestException('Select a valid truck');
    }
    const truck = await this.trucks.findOne({
      _id: truckId,
      companyId,
      status: 'active',
    });
    if (!truck) {
      throw new BadRequestException('Select an active truck in your company');
    }
    return truck._id;
  }

  private parseDueAt(value?: string | null): Date | null {
    if (value === undefined || value === null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Enter a valid task due date');
    }
    return date;
  }

  private setStatus(task: Task, status: string, actor: 'manager' | 'worker') {
    if (status === 'completed') {
      const confirmedAt = new Date();
      if (actor === 'manager') task.managerConfirmedAt ??= confirmedAt;
      else task.workerConfirmedAt ??= confirmedAt;

      const bothConfirmed = task.managerConfirmedAt && task.workerConfirmedAt;
      task.status = bothConfirmed ? 'completed' : 'pending_confirmation';
      task.completedAt = bothConfirmed ? confirmedAt : null;
      return;
    }

    task.status = status;
    task.managerConfirmedAt = null;
    task.workerConfirmedAt = null;
    task.completedAt = null;
  }
}
