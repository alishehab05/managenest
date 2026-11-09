import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Account } from '../auth/schemas/account.schema.js';
import { CompanyUser } from '../auth/schemas/company-user.schema.js';
import { Task } from './schemas/task.schema.js';
import { TasksService } from './tasks.service.js';

describe('TasksService', () => {
  const companyId = new Types.ObjectId('65a000000000000000000001');
  const workerId = new Types.ObjectId('65a000000000000000000002');
  const taskId = new Types.ObjectId('65a000000000000000000003');
  const truckId = new Types.ObjectId('65a000000000000000000004');
  let service: TasksService;
  let tasks: {
    find: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let accounts: { findOne: ReturnType<typeof vi.fn> };
  let users: { findOne: ReturnType<typeof vi.fn> };
  let trucks: { findOne: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tasks = {
      find: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn(),
    };
    accounts = { findOne: vi.fn() };
    users = { findOne: vi.fn() };
    trucks = { findOne: vi.fn() };
    service = new TasksService(
      tasks as unknown as Model<Task>,
      accounts as unknown as Model<Account>,
      users as unknown as Model<CompanyUser>,
      trucks as unknown as Model<import('../dashboard/schemas/operational-records.schema.js').Truck>,
    );
  });

  it('lists manager tasks scoped to their company and includes assignee details', async () => {
    const records = [{ _id: taskId }];
    users.findOne.mockResolvedValue({ companyId });
    tasks.find.mockReturnValue({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(records),
          }),
        }),
      }),
    });

    await expect(service.list('manager-clerk-id')).resolves.toBe(records);
    expect(tasks.find).toHaveBeenCalledWith({ companyId });
  });

  it('only returns tasks assigned to the signed-in worker', async () => {
    const records = [{ _id: taskId }];
    users.findOne.mockResolvedValue(null);
    accounts.findOne.mockResolvedValue({ _id: workerId, companyId });
    tasks.find.mockReturnValue({
      populate: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue(records),
        }),
      }),
    });

    await expect(service.list('worker-clerk-id')).resolves.toBe(records);
    expect(tasks.find).toHaveBeenCalledWith({ companyId, assigneeId: workerId });
  });

  it('rejects assignments to workers outside the manager company', async () => {
    users.findOne.mockResolvedValue({ companyId });
    accounts.findOne.mockResolvedValue(null);

    await expect(service.create('manager-clerk-id', {
      assigneeId: workerId.toString(),
      title: 'Count stock',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('stores the assignee as an ObjectId so worker task queries match', async () => {
    users.findOne.mockResolvedValue({ companyId });
    accounts.findOne.mockResolvedValue({ _id: workerId, companyId, status: 'active' });
    tasks.create.mockResolvedValue({ _id: taskId });

    await service.create('manager-clerk-id', {
      assigneeId: workerId.toString(),
      title: 'Count stock',
    });

    expect(tasks.create).toHaveBeenCalledWith(expect.objectContaining({
      companyId,
      assigneeId: workerId,
    }));
    expect(tasks.create.mock.calls[0][0].assigneeId).toBeInstanceOf(Types.ObjectId);
  });

  it('assigns an active company truck and route only to a driver', async () => {
    users.findOne.mockResolvedValue({ companyId });
    accounts.findOne.mockResolvedValue({
      _id: workerId,
      companyId,
      status: 'active',
      role: 'driver',
    });
    trucks.findOne.mockResolvedValue({ _id: truckId });
    tasks.create.mockResolvedValue({ _id: taskId });

    await service.create('manager-clerk-id', {
      assigneeId: workerId.toString(),
      title: 'Deliver materials',
      truckId: truckId.toString(),
      route: 'Factory to north warehouse',
    });

    expect(trucks.findOne).toHaveBeenCalledWith({
      _id: truckId.toString(),
      companyId,
      status: 'active',
    });
    expect(tasks.create).toHaveBeenCalledWith(expect.objectContaining({
      truckId,
      route: 'Factory to north warehouse',
    }));
  });

  it('rejects truck assignments for non-drivers and trucks outside the company', async () => {
    users.findOne.mockResolvedValue({ companyId });
    accounts.findOne.mockResolvedValue({
      _id: workerId,
      companyId,
      status: 'active',
      role: 'warehouse_operator',
    });

    await expect(service.create('manager-clerk-id', {
      assigneeId: workerId.toString(),
      title: 'Move goods',
      truckId: truckId.toString(),
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(trucks.findOne).not.toHaveBeenCalled();

    accounts.findOne.mockResolvedValue({
      _id: workerId,
      companyId,
      status: 'active',
      role: 'driver',
    });
    trucks.findOne.mockResolvedValue(null);

    await expect(service.create('manager-clerk-id', {
      assigneeId: workerId.toString(),
      title: 'Move goods',
      truckId: truckId.toString(),
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('requires manager and worker confirmation before marking a task completed', async () => {
    const task = {
      _id: taskId,
      companyId,
      assigneeId: workerId,
      status: 'in_progress',
      managerConfirmedAt: null,
      workerConfirmedAt: null,
      completedAt: null,
      save: vi.fn().mockResolvedValue(undefined),
    };
    users.findOne.mockResolvedValue({ companyId });
    tasks.findOne.mockResolvedValue(task);

    await service.update('manager-clerk-id', taskId.toString(), { status: 'completed' });

    expect(task.status).toBe('pending_confirmation');
    expect(task.managerConfirmedAt).toBeInstanceOf(Date);
    expect(task.workerConfirmedAt).toBeNull();
    expect(task.completedAt).toBeNull();

    accounts.findOne.mockResolvedValue({ _id: workerId, companyId, status: 'active' });
    await service.updateOwnStatus('worker-clerk-id', taskId.toString(), 'completed');

    expect(task.status).toBe('completed');
    expect(task.managerConfirmedAt).toBeInstanceOf(Date);
    expect(task.workerConfirmedAt).toBeInstanceOf(Date);
    expect(task.completedAt).toBeInstanceOf(Date);
    expect(task.save).toHaveBeenCalledTimes(2);
  });

  it('keeps worker-first completion pending until the manager confirms', async () => {
    const task = {
      _id: taskId,
      companyId,
      assigneeId: workerId,
      status: 'in_progress',
      managerConfirmedAt: null,
      workerConfirmedAt: null,
      completedAt: null,
      save: vi.fn().mockResolvedValue(undefined),
    };
    accounts.findOne.mockResolvedValue({ _id: workerId, companyId, status: 'active' });
    tasks.findOne.mockResolvedValue(task);

    await service.updateOwnStatus('worker-clerk-id', taskId.toString(), 'completed');

    expect(task.status).toBe('pending_confirmation');
    expect(task.workerConfirmedAt).toBeInstanceOf(Date);
    expect(task.managerConfirmedAt).toBeNull();
    expect(task.completedAt).toBeNull();
  });

  it('prevents workers from changing tasks assigned to another worker', async () => {
    accounts.findOne.mockResolvedValue({ _id: workerId, companyId });
    tasks.findOne.mockResolvedValue(null);

    await expect(service.updateOwnStatus(
      'worker-clerk-id',
      taskId.toString(),
      'completed',
    )).rejects.toBeInstanceOf(NotFoundException);
    expect(tasks.findOne).toHaveBeenCalledWith({
      _id: taskId.toString(),
      companyId,
      assigneeId: workerId,
    });
  });
});
