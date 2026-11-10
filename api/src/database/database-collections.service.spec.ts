import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { ClerkUsersService } from '../auth/clerk-users.service.js';
import { ERP_COLLECTIONS } from './erp-collections.js';
import { DatabaseCollectionsService } from './database-collections.service.js';

describe('DatabaseCollectionsService', () => {
  it('repairs truck expense records whose warehouse IDs were stored as plain objects', async () => {
    const companyId = new Types.ObjectId('65a000000000000000000011');
    const truckId = new Types.ObjectId('65a000000000000000000012');
    const warehouseId = new Types.ObjectId('65a000000000000000000013');
    const recordId = new Types.ObjectId('65a000000000000000000014');
    const truckExpenses = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{
          _id: recordId,
          companyId,
          truckId,
        }]),
      }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const trucks = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
      findOne: vi.fn().mockResolvedValue({ warehouseId }),
    };
    const emptyCollection = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    };
    const accounts = {
      ...emptyCollection,
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const database = {
      listCollections: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(ERP_COLLECTIONS.map((name) => ({ name }))),
      }),
      collection: vi.fn((name: string) => {
        if (name === 'truckExpenses') return truckExpenses;
        if (name === 'trucks') return trucks;
        if (name === 'accounts') return accounts;
        return emptyCollection;
      }),
    };
    const connection = { readyState: 1, db: database } as unknown as Connection;
    const service = new DatabaseCollectionsService(
      connection,
      {} as ClerkUsersService,
    );

    await service.onModuleInit();

    expect(trucks.findOne).toHaveBeenCalledWith(
      { _id: truckId, companyId, warehouseId: { $type: 'objectId' } },
      { projection: { warehouseId: 1 } },
    );
    expect(truckExpenses.updateOne).toHaveBeenCalledWith(
      { _id: recordId, companyId },
      { $set: { warehouseId, updatedAt: expect.any(Date) } },
    );
  });

  it('converts legacy warehouse company IDs only when they match an existing company', async () => {
    const companyId = new Types.ObjectId('65a000000000000000000001');
    const driverId = new Types.ObjectId('65a000000000000000000002');
    const warehouseId = new Types.ObjectId('65a000000000000000000003');
    const warehouses = { updateMany: vi.fn().mockResolvedValue({ modifiedCount: 2 }) };
    const companies = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: companyId }]),
      }),
    };
    const emptyCollection = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    };
    const accounts = {
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    };
    const trucks = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{
          companyId,
          driverId,
          warehouseId,
        }]),
      }),
    };
    const database = {
      listCollections: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(ERP_COLLECTIONS.map((name) => ({ name }))),
      }),
      collection: vi.fn((name: string) => {
        if (name === 'companies') return companies;
        if (name === 'warehouses') return warehouses;
        if (name === 'accounts') return accounts;
        if (name === 'trucks') return trucks;
        return emptyCollection;
      }),
    };
    const connection = { readyState: 1, db: database } as unknown as Connection;
    const service = new DatabaseCollectionsService(
      connection,
      {} as ClerkUsersService,
    );

    await service.onModuleInit();

    expect(warehouses.updateMany).toHaveBeenCalledWith(
      { companyId: { $type: 'string', $in: [companyId.toString()] } },
      [{ $set: { companyId: { $toObjectId: '$companyId' } } }],
    );
    expect(accounts.updateMany).toHaveBeenCalledWith(
      { specialties: { $exists: true } },
      [
        {
          $set: {
            specialty: {
              $cond: [
                { $eq: ['$role', 'driver'] },
                {
                  $ifNull: [
                    '$specialty',
                    { $arrayElemAt: [{ $ifNull: ['$specialties', []] }, 0] },
                  ],
                },
                null,
              ],
            },
          },
        },
        { $unset: 'specialties' },
      ],
    );
    expect(accounts.updateOne).toHaveBeenCalledWith(
      { _id: driverId, companyId, role: 'driver' },
      { $set: { warehouseIds: [warehouseId] } },
    );
  });
});
