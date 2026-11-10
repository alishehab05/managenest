import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompaniesService } from '../companies/companies.service.js';
import { DashboardService } from './dashboard.service.js';

describe('DashboardService', () => {
  const companyId = new Types.ObjectId('65a000000000000000000001');
  const truckId = new Types.ObjectId('65a000000000000000000002');
  const expenseId = new Types.ObjectId('65a000000000000000000003');
  const incurredAt = new Date('2025-03-14T12:00:00.000Z');
  let service: DashboardService;
  let expenseCollection: {
    aggregate: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    countDocuments: ReturnType<typeof vi.fn>;
  };
  let warehouseCollection: { findOne: ReturnType<typeof vi.fn> };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    const records = [{
      _id: expenseId,
      category: 'fuel',
      amount: Types.Decimal128.fromString('125.50'),
      currencyCode: 'USD',
      paymentStatus: 'paid',
      incurredAt,
      warehouseId: new Types.ObjectId('65a000000000000000000004'),
      truckId,
      tripId: null,
      costCenterType: 'truck',
      costCenterId: truckId,
    }];
    expenseCollection = {
      aggregate: vi.fn((pipeline: Record<string, unknown>[]) => {
        const lastStage = pipeline[pipeline.length - 1];
        const rows = '$count' in lastStage
          ? [{ count: 1 }]
          : '$limit' in lastStage
            ? records
            : [{ total: Types.Decimal128.fromString('125.50') }];
        return { toArray: vi.fn().mockResolvedValue(rows) };
      }),
      find: vi.fn((filter: Record<string, unknown> = {}) => ({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue('currencyCode' in filter ? [] : records),
          }),
        }),
      })),
      countDocuments: vi.fn().mockResolvedValue(0),
    };
    warehouseCollection = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn(() => ({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
      })),
      countDocuments: vi.fn().mockResolvedValue(0),
    };
    const db = {
      collection: vi.fn((name: string) =>
        name === 'expenses' ? expenseCollection : warehouseCollection,
      ),
    };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    service = new DashboardService(connection, companies);
  });

  it('scopes company expense records and totals by company and validated filters', async () => {
    const result = await service.getCompanyExpenses('clerk-user', {
      from: '2025-03-01',
      to: '2025-03-14',
      category: 'fuel',
      truckId: truckId.toString(),
      paymentStatus: 'paid',
    });

    expect(expenseCollection.aggregate.mock.calls[1][0][0].$match).toEqual(expect.objectContaining({
      companyId,
      category: 'fuel',
      truckId,
      paymentStatus: 'paid',
      incurredAt: {
        $gte: new Date('2025-03-01T00:00:00.000Z'),
        $lte: new Date('2025-03-14T23:59:59.999Z'),
      },
    }));
    expect(result).toMatchObject({
      total: 125.5,
      count: 1,
      limit: 200,
      currencyCode: 'USD',
      unconvertedCount: 0,
      records: [{
        id: expenseId.toString(),
        category: 'fuel',
        amount: 125.5,
        truckId: truckId.toString(),
      }],
    });
    const sumExpression = expenseCollection.aggregate.mock.calls[0][0][1].$group.total.$sum;
    expect(sumExpression.$cond[0]).toEqual({
      $eq: [{ $toUpper: '$currencyCode' }, 'USD'],
    });
    expect(sumExpression.$cond[2].$convert.input).toBe('$baseAmount');
  });

  it('converts legacy expenses before calculating company expense totals', async () => {
    const legacyExpense = {
      _id: expenseId,
      companyId,
      amount: Types.Decimal128.fromString('10.00'),
      currencyCode: 'EUR',
      incurredAt,
      baseAmount: null,
    };
    const expenseCollection = {
      find: vi.fn((filter: Record<string, unknown> = {}) => ({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue('currencyCode' in filter ? [legacyExpense] : []),
          }),
        }),
      })),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      countDocuments: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn((pipeline: Record<string, unknown>[]) => {
        const lastStage = pipeline[pipeline.length - 1];
        const rows = '$count' in lastStage
          ? [{ count: 0 }]
          : '$limit' in lastStage
            ? []
            : [{ total: Types.Decimal128.fromString('8.00') }];
        return { toArray: vi.fn().mockResolvedValue(rows) };
      }),
    };
    const otherCollection = {
      find: vi.fn(() => ({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
      })),
      countDocuments: vi.fn().mockResolvedValue(0),
    };
    const companiesCollection = {
      findOne: vi.fn().mockResolvedValue({ baseCurrencyCode: 'GBP' }),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'expenses') return expenseCollection;
        if (name === 'companies') return companiesCollection;
        return otherCollection;
      }),
    };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ date: '2025-03-14', rates: { GBP: 0.8 } }),
    }));

    const result = await moduleService.getCompanyExpenses('clerk-user');

    expect(result).toMatchObject({
      total: 8,
      currencyCode: 'GBP',
      unconvertedCount: 0,
    });
    expect(expenseCollection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expenseId, companyId, baseAmount: null }),
      expect.objectContaining({
        $set: expect.objectContaining({
          baseAmount: Types.Decimal128.fromString('8.00'),
          exchangeRate: Types.Decimal128.fromString('0.8000000000'),
        }),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://api.frankfurter.dev/v1/2025-03-14?base=EUR&symbols=GBP',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('rejects invalid expense filter identifiers', async () => {
    await expect(service.getCompanyExpenses('clerk-user', {
      truckId: 'not-an-object-id',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(expenseCollection.find).not.toHaveBeenCalled();
  });

  it('returns company-scoped module records without exposing credential fields', async () => {
    const records = [{
      _id: expenseId,
      companyId,
      amount: Types.Decimal128.fromString('12.50'),
      passwordHash: 'must-not-leak',
      details: { accessToken: 'must-not-leak', note: 'Warehouse supplies' },
    }];
    const moduleCollection = {
      countDocuments: vi.fn().mockResolvedValue(1),
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          skip: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(records),
            }),
          }),
        }),
      }),
    };
    const db = { collection: vi.fn(() => moduleCollection) };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    const result = await moduleService.getCompanyModuleRecords('clerk-user', 'purchases');

    expect(moduleCollection.countDocuments).toHaveBeenCalledWith({ companyId });
    expect(moduleCollection.find).toHaveBeenCalledWith({ companyId });
    expect(result).toMatchObject({
      collection: 'purchases',
      total: 1,
      limit: 50,
      page: 1,
      records: [{
        _id: expenseId.toString(),
        companyId: companyId.toString(),
        amount: '12.50',
        details: { note: 'Warehouse supplies' },
      }],
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('resolves warehouse modules from the ERP collection registry', async () => {
    const warehouseCollection = {
      countDocuments: vi.fn().mockResolvedValue(0),
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          skip: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    };
    const db = { collection: vi.fn(() => warehouseCollection) };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    const result = await moduleService.getCompanyModuleRecords('clerk-user', 'WAREHOUSES');

    expect(db.collection).toHaveBeenCalledWith('warehouses');
    expect(warehouseCollection.find).toHaveBeenCalledWith({ companyId });
    expect(result.collection).toBe('warehouses');
  });

  it('only offers active driver-role workers for transport assignments', async () => {
    const accounts = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };
    const db = { collection: vi.fn(() => accounts) };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    await moduleService.getCompanyModuleOptions('clerk-user', 'accounts');

    expect(accounts.find).toHaveBeenCalledWith({
      companyId,
      role: 'driver',
      status: 'active',
    });
  });

  it('returns the company warehouses as current relationship choices', async () => {
    const warehouseId = new Types.ObjectId('65a000000000000000000099');
    const warehouses = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([{
              _id: warehouseId,
              companyId,
              code: 'NEW',
              name: 'New warehouse',
              status: 'active',
            }]),
          }),
        }),
      }),
    };
    const db = { collection: vi.fn(() => warehouses) };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    const result = await moduleService.getCompanyModuleOptions('clerk-user', 'warehouses');

    expect(warehouses.find).toHaveBeenCalledWith({ companyId, status: 'active' });
    expect(result).toEqual([{
      _id: warehouseId.toString(),
      companyId: companyId.toString(),
      code: 'NEW',
      name: 'New warehouse',
      status: 'active',
    }]);
  });

  it('returns company customers as sales relationship choices', async () => {
    const customerId = new Types.ObjectId('65a000000000000000000099');
    const customers = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([{
              _id: customerId,
              companyId,
              name: 'Factory Customer',
              status: 'active',
            }]),
          }),
        }),
      }),
    };
    const db = { collection: vi.fn(() => customers) };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    const result = await moduleService.getCompanyModuleOptions('clerk-user', 'customers');

    expect(db.collection).toHaveBeenCalledWith('customers');
    expect(customers.find).toHaveBeenCalledWith({ companyId });
    expect(result).toEqual([{
      _id: customerId.toString(),
      companyId: companyId.toString(),
      name: 'Factory Customer',
      status: 'active',
    }]);
  });

  it('returns only active company expense categories for category dropdowns', async () => {
    const categoryId = new Types.ObjectId('65a000000000000000000099');
    const categoryRecord = {
      _id: categoryId,
      companyId,
      name: 'Packaging',
      status: 'active',
    };
    const categories = {
      find: vi.fn()
        .mockReturnValueOnce({
          toArray: vi.fn().mockResolvedValue([categoryRecord]),
        })
        .mockReturnValue({
          sort: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([categoryRecord]),
            }),
          }),
        }),
      updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
    };
    const db = { collection: vi.fn(() => categories) };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    const result = await moduleService.getCompanyModuleOptions('clerk-user', 'expenseCategories');

    expect(db.collection).toHaveBeenCalledWith('expenseCategories');
    expect(categories.find).toHaveBeenNthCalledWith(1, { companyId }, {
      projection: { name: 1, code: 1 },
    });
    expect(categories.find).toHaveBeenNthCalledWith(2, {
      companyId,
      $or: [
        { status: 'active' },
        { status: { $exists: false } },
        { status: null },
      ],
    });
    expect(categories.updateOne).toHaveBeenCalledWith(
      { companyId, code: 'FUEL' },
      {
        $setOnInsert: expect.objectContaining({
          companyId,
          code: 'FUEL',
          name: 'Fuel',
          status: 'active',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      },
      { upsert: true },
    );
    expect(result).toEqual([{
      _id: categoryId.toString(),
      companyId: companyId.toString(),
      name: 'Packaging',
      status: 'active',
    }]);
  });

  it('lets a company manager update the company base currency', async () => {
    const company = {
      _id: companyId,
      name: 'Factory Company',
      baseCurrencyCode: 'LBP',
    };
    const companiesCollection = {
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue(company),
    };
    const db = { collection: vi.fn(() => companiesCollection) };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    const result = await moduleService.updateCompanyPreferences('clerk-user', {
      name: 'Factory Company',
      baseCurrencyCode: 'LBP',
    });

    expect(companiesCollection.updateOne).toHaveBeenCalledWith(
      { _id: companyId },
      {
        $set: expect.objectContaining({
          name: 'Factory Company',
          baseCurrencyCode: 'LBP',
          updatedAt: expect.any(Date),
        }),
      },
    );
    expect(result).toMatchObject({ name: 'Factory Company', baseCurrencyCode: 'LBP' });
  });

  it('rejects truck assignments to workers without an active driver role', async () => {
    const warehouseId = new Types.ObjectId('65a000000000000000000099');
    const warehouses = {
      findOne: vi.fn().mockResolvedValue({ _id: warehouseId }),
    };
    const accounts = {
      findOne: vi.fn().mockResolvedValue(null),
    };
    const trucks = { insertOne: vi.fn() };
    const db = {
      collection: vi.fn((name: string) =>
        name === 'warehouses' ? warehouses : name === 'accounts' ? accounts : trucks,
      ),
    };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);
    const workerId = new Types.ObjectId('65a000000000000000000098');

    await expect(moduleService.createCompanyModuleRecord('clerk-user', 'trucks', {
      warehouseId: warehouseId.toString(),
      name: 'Truck 1',
      registrationNumber: 'ABC-123',
      driverId: workerId.toString(),
    })).rejects.toThrow('active driver worker');

    expect(accounts.findOne).toHaveBeenCalledWith({
      _id: workerId,
      companyId,
      role: 'driver',
      status: 'active',
    }, { projection: { _id: 1 } });
    expect(trucks.insertOne).not.toHaveBeenCalled();
  });

  it('does not allow querying arbitrary MongoDB collections', async () => {
    await expect(service.getCompanyModuleRecords('clerk-user', 'system.users'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates records in the authenticated company and assigns ownership server-side', async () => {
    const savedRecord = {
      _id: expenseId,
      companyId,
      description: 'Packaging',
      amount: Types.Decimal128.fromString('12.50'),
    };
    const moduleCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: expenseId }),
      findOne: vi.fn().mockResolvedValue(savedRecord),
    };
    const db = { collection: vi.fn(() => moduleCollection) };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    await moduleService.createCompanyModuleRecord('clerk-user', 'purchases', {
      description: 'Packaging',
      amount: '12.50',
    });

    const inserted = moduleCollection.insertOne.mock.calls[0][0];
    expect(inserted).toMatchObject({
      companyId,
      description: 'Packaging',
      amount: Types.Decimal128.fromString('12.50'),
    });
    expect(inserted._id).toBeUndefined();
    expect(moduleCollection.findOne).toHaveBeenCalledWith({ _id: expenseId, companyId });
  });

  it('defaults newly created expense categories to active', async () => {
    const categories = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: expenseId }),
      findOne: vi.fn().mockResolvedValue({
        _id: expenseId,
        companyId,
        name: 'Fuel',
        status: 'active',
      }),
    };
    const db = { collection: vi.fn(() => categories) };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    await moduleService.createCompanyModuleRecord('clerk-user', 'expenseCategories', {
      name: 'Fuel',
    });

    expect(categories.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      companyId,
      name: 'Fuel',
      status: 'active',
    }));
  });

  it('assigns a new fuel log to its truck warehouse without requiring a warehouse input', async () => {
    const warehouseId = new Types.ObjectId('65a000000000000000000004');
    const truck = { _id: truckId, companyId, warehouseId, status: 'active' };
    const savedFuelLog = { _id: expenseId, companyId, truckId, warehouseId };
    const fuelLogs = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: expenseId }),
      findOne: vi.fn().mockResolvedValue(savedFuelLog),
    };
    const trucks = { findOne: vi.fn().mockResolvedValue(truck) };
    const companiesCollection = {
      findOne: vi.fn().mockResolvedValue({ baseCurrencyCode: 'USD' }),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'fuelLogs') return fuelLogs;
        if (name === 'trucks') return trucks;
        return companiesCollection;
      }),
    };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    await moduleService.createCompanyModuleRecord('clerk-user', 'fuelLogs', {
      truckId: truckId.toString(),
      quantityLiters: '20',
      unitPrice: '1.50',
      currencyCode: 'USD',
    });

    expect(fuelLogs.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      companyId,
      truckId,
      warehouseId,
      baseAmount: Types.Decimal128.fromString('30.00'),
    }));
  });

  it('preserves the stored truck warehouse when partially updating a fuel log', async () => {
    const warehouseId = new Types.ObjectId('65a000000000000000000004');
    const existing = {
      _id: expenseId,
      companyId,
      truckId,
      warehouseId,
      quantityLiters: Types.Decimal128.fromString('20'),
      unitPrice: Types.Decimal128.fromString('1.50'),
      currencyCode: 'USD',
    };
    const updated = { ...existing, unitPrice: Types.Decimal128.fromString('1.75') };
    const fuelLogs = {
      findOne: vi.fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const companiesCollection = {
      findOne: vi.fn().mockResolvedValue({ baseCurrencyCode: 'USD' }),
    };
    const db = {
      collection: vi.fn((name: string) => name === 'fuelLogs' ? fuelLogs : companiesCollection),
    };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    await moduleService.updateCompanyModuleRecord(
      'clerk-user',
      'fuelLogs',
      expenseId.toString(),
      { unitPrice: '1.75' },
    );

    expect(fuelLogs.updateOne).toHaveBeenCalledWith(
      { _id: expenseId, companyId },
      { $set: expect.objectContaining({ warehouseId, unitPrice: Types.Decimal128.fromString('1.75') }) },
    );
  });

  it('preserves the stored truck warehouse when partially updating a truck expense', async () => {
    const warehouseId = new Types.ObjectId('65a000000000000000000004');
    const existing = {
      _id: expenseId,
      companyId,
      warehouseId,
      costCenterType: 'truck',
      costCenterId: truckId,
      amount: Types.Decimal128.fromString('10.00'),
      currencyCode: 'USD',
    };
    const expenses = {
      findOne: vi.fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ ...existing, amount: Types.Decimal128.fromString('12.50') }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const companiesCollection = {
      findOne: vi.fn().mockResolvedValue({ baseCurrencyCode: 'USD' }),
    };
    const db = {
      collection: vi.fn((name: string) => name === 'expenses' ? expenses : companiesCollection),
    };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    await moduleService.updateCompanyModuleRecord(
      'clerk-user',
      'expenses',
      expenseId.toString(),
      { amount: '12.50' },
    );

    expect(expenses.updateOne).toHaveBeenCalledWith(
      { _id: expenseId, companyId },
      { $set: expect.objectContaining({ warehouseId, amount: Types.Decimal128.fromString('12.50') }) },
    );
  });

  it('synchronizes driver warehouse access when a truck assignment changes', async () => {
    const oldDriverId = new Types.ObjectId('65a000000000000000000010');
    const newDriverId = new Types.ObjectId('65a000000000000000000011');
    const oldWarehouseId = new Types.ObjectId('65a000000000000000000012');
    const newWarehouseId = new Types.ObjectId('65a000000000000000000013');
    const existing = { _id: truckId, driverId: oldDriverId, warehouseId: oldWarehouseId };
    const updated = { _id: truckId, driverId: newDriverId, warehouseId: newWarehouseId };
    const trucks = {
      findOne: vi.fn().mockResolvedValueOnce(existing).mockResolvedValueOnce(updated),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      find: vi.fn().mockImplementation(({ driverId }) => ({
        toArray: vi.fn().mockResolvedValue(
          driverId.equals(newDriverId) ? [{ warehouseId: newWarehouseId }] : [],
        ),
      })),
    };
    const warehouses = { findOne: vi.fn().mockResolvedValue({ _id: newWarehouseId }) };
    const accounts = {
      findOne: vi.fn().mockResolvedValue({ _id: newDriverId }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'trucks') return trucks;
        if (name === 'warehouses') return warehouses;
        return accounts;
      }),
    };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    await moduleService.updateCompanyModuleRecord('clerk-user', 'trucks', truckId.toString(), {
      driverId: newDriverId.toString(),
      warehouseId: newWarehouseId.toString(),
    });

    expect(accounts.updateOne).toHaveBeenCalledWith(
      { _id: oldDriverId, companyId, role: 'driver' },
      { $set: { warehouseIds: [], updatedAt: expect.any(Date) } },
      {},
    );
    expect(accounts.updateOne).toHaveBeenCalledWith(
      { _id: newDriverId, companyId, role: 'driver' },
      { $set: { warehouseIds: [newWarehouseId], updatedAt: expect.any(Date) } },
      {},
    );
  });

  it('falls back to the latest published rate when historical data is unavailable', async () => {
    const warehouseId = new Types.ObjectId('65a000000000000000000004');
    const expenses = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: expenseId }),
      findOne: vi.fn().mockResolvedValue({ _id: expenseId, companyId }),
    };
    const companiesCollection = {
      findOne: vi.fn().mockResolvedValue({ baseCurrencyCode: 'USD' }),
    };
    const references = {
      findOne: vi.fn().mockImplementation(({ _id }) => Promise.resolve({ _id })),
    };
    const trucks = {
      findOne: vi.fn().mockResolvedValue({
        _id: truckId,
        warehouseId,
        status: 'active',
      }),
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'success', rates: { USD: 1, EUR: 0.8 } }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'expenses') return expenses;
        if (name === 'companies') return companiesCollection;
        if (name === 'trucks') return trucks;
        return references;
      }),
    };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    await moduleService.createCompanyModuleRecord('clerk-user', 'expenses', {
      warehouseId: warehouseId.toString(),
      category: 'fuel',
      costCenterType: 'truck',
      costCenterId: truckId.toString(),
      amount: '10.00',
      currencyCode: 'EUR',
    });

    expect(expenses.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      amount: Types.Decimal128.fromString('10.00'),
      currencyCode: 'EUR',
      baseAmount: Types.Decimal128.fromString('12.50'),
      exchangeRate: Types.Decimal128.fromString('1.2500000000'),
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://open.er-api.com/v6/latest/USD');
  });

  it('converts legacy fuel logs using the historical rate from their transaction date', async () => {
    const fuelLog = {
      _id: new Types.ObjectId('65a000000000000000000007'),
      companyId,
      quantityLiters: Types.Decimal128.fromString('20'),
      unitPrice: Types.Decimal128.fromString('1.50'),
      currencyCode: 'EUR',
      occurredAt: new Date('2025-03-14T12:00:00.000Z'),
    };
    const fuelLogs = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([fuelLog]),
          }),
        }),
      }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      countDocuments: vi.fn().mockResolvedValue(0),
    };
    const truckExpenses = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      countDocuments: vi.fn().mockResolvedValue(0),
    };
    const expenses = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      countDocuments: vi.fn().mockResolvedValue(0),
    };
    const companiesCollection = {
      findOne: vi.fn().mockResolvedValue({ baseCurrencyCode: 'USD' }),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'fuelLogs') return fuelLogs;
        if (name === 'expenses') return expenses;
        if (name === 'truckExpenses') return truckExpenses;
        return companiesCollection;
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ date: '2025-03-14', rates: { USD: 1.08 } }),
    }));
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    await expect(moduleService.convertUnconvertedCompanyExpenses('clerk-user')).resolves.toMatchObject({
      convertedCount: 1,
      remainingCount: 0,
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.frankfurter.dev/v1/2025-03-14?base=EUR&symbols=USD',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fuelLogs.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: fuelLog._id, companyId, baseAmount: null }),
      expect.objectContaining({
        $set: expect.objectContaining({
          baseAmount: Types.Decimal128.fromString('32.40'),
          exchangeRate: Types.Decimal128.fromString('1.0800000000'),
        }),
      }),
    );
  });

  it('rejects attempts to set company ownership or update a foreign record', async () => {
    await expect(service.createCompanyModuleRecord('clerk-user', 'purchases', {
      companyId: new Types.ObjectId().toString(),
    })).rejects.toBeInstanceOf(BadRequestException);

    const moduleCollection = {
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }),
      findOne: vi.fn(),
    };
    const db = { collection: vi.fn(() => moduleCollection) };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);
    await expect(moduleService.updateCompanyModuleRecord(
      'clerk-user',
      'purchases',
      expenseId.toString(),
      { description: 'Modified' },
    )).rejects.toBeInstanceOf(NotFoundException);
    expect(moduleCollection.updateOne).toHaveBeenCalledWith(
      { _id: expenseId, companyId },
      expect.objectContaining({ $set: expect.objectContaining({ description: 'Modified' }) }),
    );
  });

  it('prevents deleting a truck that is referenced by other company records', async () => {
    const truckCollection = {
      findOne: vi.fn()
        .mockResolvedValueOnce({ _id: truckId })
        .mockResolvedValueOnce({ _id: expenseId }),
      deleteOne: vi.fn(),
    };
    const db = { collection: vi.fn(() => truckCollection) };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    await expect(moduleService.deleteCompanyModuleRecord(
      'clerk-user',
      'trucks',
      truckId.toString(),
    )).rejects.toThrow('linked to other company records');
    expect(truckCollection.deleteOne).not.toHaveBeenCalled();
  });

  it('rejects references to records outside the authenticated company', async () => {
    const warehouseCollection = { findOne: vi.fn().mockResolvedValue({ _id: new Types.ObjectId('65a000000000000000000099') }) };
    const truckCollection = { findOne: vi.fn().mockResolvedValue(null) };
    const expenseCollection = { insertOne: vi.fn() };
    const db = {
      collection: vi.fn((name: string) =>
        name === 'warehouses' ? warehouseCollection : name === 'trucks' ? truckCollection : expenseCollection,
      ),
    };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    await expect(moduleService.createCompanyModuleRecord('clerk-user', 'expenses', {
      warehouseId: '65a000000000000000000099',
      category: 'fuel',
      costCenterType: 'truck',
      costCenterId: '65a000000000000000000099',
      amount: '10.00',
      currencyCode: 'USD',
    })).rejects.toThrow('active company truck with a warehouse');
    expect(expenseCollection.insertOne).not.toHaveBeenCalled();
  });

  it('does not return a warehouse outside the manager company', async () => {
    await expect(service.getWarehouseOverview(
      'clerk-user',
      '65a000000000000000000099',
    )).rejects.toBeInstanceOf(NotFoundException);
    expect(warehouseCollection.findOne).toHaveBeenCalledWith({
      _id: new Types.ObjectId('65a000000000000000000099'),
      companyId,
    });
  });

  it('transfers a truck and records the move without rewriting history', async () => {
    const oldWarehouseId = new Types.ObjectId('65a000000000000000000005');
    const newWarehouseId = new Types.ObjectId('65a000000000000000000006');
    const driverId = new Types.ObjectId('65a000000000000000000007');
    const truckCollection = {
      findOne: vi.fn().mockResolvedValue({ warehouseId: oldWarehouseId, assetId: null, driverId }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ warehouseId: newWarehouseId }]),
      }),
    };
    const warehouses = { findOne: vi.fn().mockResolvedValue({ _id: newWarehouseId }) };
    const movementCollection = { insertOne: vi.fn().mockResolvedValue({ insertedId: expenseId }) };
    const accounts = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
    const session = {
      withTransaction: vi.fn(async (callback: () => Promise<void>) => callback()),
      endSession: vi.fn().mockResolvedValue(undefined),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'trucks') return truckCollection;
        if (name === 'warehouses') return warehouses;
        if (name === 'accounts') return accounts;
        return movementCollection;
      }),
    };
    const connection = { db, startSession: vi.fn().mockResolvedValue(session) } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const transferService = new DashboardService(connection, companies);

    await transferService.transferTruck('clerk-user', truckId.toString(), newWarehouseId.toString());

    expect(truckCollection.updateOne).toHaveBeenCalledWith(
      { _id: truckId, companyId, warehouseId: oldWarehouseId },
      expect.objectContaining({ $set: expect.objectContaining({ warehouseId: newWarehouseId }) }),
      { session },
    );
    expect(movementCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        truckId,
        fromWarehouseId: oldWarehouseId,
        toWarehouseId: newWarehouseId,
        movementType: 'warehouse_transfer',
      }),
      { session },
    );
    expect(accounts.updateOne).toHaveBeenCalledWith(
      { _id: driverId, companyId, role: 'driver' },
      { $set: { warehouseIds: [newWarehouseId], updatedAt: expect.any(Date) } },
      { session },
    );
    expect(db.collection).not.toHaveBeenCalledWith('expenses');
    expect(db.collection).not.toHaveBeenCalledWith('trips');
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('includes unlinked fuel logs in company overview expense aggregations', async () => {
    const emptyCursor = { toArray: vi.fn().mockResolvedValue([]) };
    const expenseCollection = {
      aggregate: vi.fn().mockReturnValue(emptyCursor),
      countDocuments: vi.fn().mockResolvedValue(0),
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue(emptyCursor),
        }),
      }),
    };
    const fuelLogCollection = {
      countDocuments: vi.fn().mockResolvedValue(0),
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue(emptyCursor),
        }),
      }),
    };
    const companiesCollection = {
      findOne: vi.fn().mockResolvedValue({ baseCurrencyCode: 'USD' }),
    };
    const warehousesCollection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue(emptyCursor),
      }),
    };
    const otherCollection = {
      aggregate: vi.fn().mockReturnValue(emptyCursor),
      countDocuments: vi.fn().mockResolvedValue(0),
      distinct: vi.fn().mockResolvedValue([]),
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue(emptyCursor),
        }),
      }),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'expenses') return expenseCollection;
        if (name === 'fuelLogs') return fuelLogCollection;
        if (name === 'companies') return companiesCollection;
        if (name === 'warehouses') return warehousesCollection;
        return otherCollection;
      }),
    };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const dashboardService = new DashboardService(connection, companies);

    const dashboard = await dashboardService.getCompanyDashboard('clerk-user');

    expect(dashboard.kpis).toHaveProperty('inventoryStockKg');
    expect(dashboard.kpis).not.toHaveProperty('cocoaStockKg');
    expect(expenseCollection.find).toHaveBeenCalledWith(expect.objectContaining({
      companyId,
      currencyCode: { $ne: 'USD' },
      $or: [{ baseAmount: null }, { baseAmount: { $exists: false } }],
    }));
    expect(fuelLogCollection.find).toHaveBeenCalledWith(expect.objectContaining({
      companyId,
      currencyCode: { $ne: 'USD' },
      expenseId: null,
    }));
    const pipelines = expenseCollection.aggregate.mock.calls.map(([pipeline]) => pipeline);
    expect(pipelines.length).toBeGreaterThanOrEqual(9);
    expect(pipelines.every((pipeline) =>
      pipeline.some((stage: { $unionWith?: { coll: string } }) =>
        stage.$unionWith?.coll === 'fuelLogs',
      ),
    )).toBe(true);
    expect(pipelines.every((pipeline) =>
      pipeline.some((stage: { $unionWith?: { coll: string } }) =>
        stage.$unionWith?.coll === 'truckExpenses',
      ),
    )).toBe(true);
    const fuelLogUnion = pipelines[0].find(
      (stage: { $unionWith?: { coll: string } }) => stage.$unionWith?.coll === 'fuelLogs',
    ).$unionWith;
    expect(fuelLogUnion.pipeline[0].$match).toMatchObject({
      companyId,
      expenseId: null,
    });
    expect(fuelLogUnion.pipeline[1].$addFields).toMatchObject({
      category: 'fuel',
      incurredAt: '$occurredAt',
    });
    expect(fuelLogUnion.pipeline[1].$addFields.amount.$multiply.map(
      (operand: { $convert: { input: string } }) => operand.$convert.input,
    )).toEqual(['$quantityLiters', '$unitPrice']);
    expect(fuelLogCollection.countDocuments).toHaveBeenCalledWith(expect.objectContaining({
      companyId,
      expenseId: null,
    }));
  });
});
