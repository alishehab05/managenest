import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { ClerkUsersService } from '../auth/clerk-users.service.js';
import { ERP_COLLECTIONS } from './erp-collections.js';
import { DatabaseCollectionsService } from './database-collections.service.js';

describe('DatabaseCollectionsService', () => {
  it('converts legacy warehouse company IDs only when they match an existing company', async () => {
    const companyId = new Types.ObjectId('65a000000000000000000001');
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
    const database = {
      listCollections: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(ERP_COLLECTIONS.map((name) => ({ name }))),
      }),
      collection: vi.fn((name: string) => {
        if (name === 'companies') return companies;
        if (name === 'warehouses') return warehouses;
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
  });
});
