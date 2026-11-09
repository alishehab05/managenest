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
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{
          total: Types.Decimal128.fromString('125.50'),
        }]),
      }),
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(records),
          }),
        }),
      }),
      countDocuments: vi.fn().mockResolvedValue(1),
    };
    warehouseCollection = {
      findOne: vi.fn().mockResolvedValue(null),
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

    expect(expenseCollection.find).toHaveBeenCalledWith(expect.objectContaining({
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
      unconvertedCount: 1,
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
    const categories = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([{
              _id: categoryId,
              companyId,
              name: 'Packaging',
              status: 'active',
            }]),
          }),
        }),
      }),
    };
    const db = { collection: vi.fn(() => categories) };
    const connection = { db } as unknown as Connection;
    const companies = {
      requireCompanyId: vi.fn().mockResolvedValue(companyId.toString()),
    } as unknown as CompaniesService;
    const moduleService = new DashboardService(connection, companies);

    const result = await moduleService.getCompanyModuleOptions('clerk-user', 'expenseCategories');

    expect(db.collection).toHaveBeenCalledWith('expenseCategories');
    expect(categories.find).toHaveBeenCalledWith({ companyId, status: 'active' });
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
    })).rejects.toThrow('record in your company');
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
    const truckCollection = {
      findOne: vi.fn().mockResolvedValue({ warehouseId: oldWarehouseId, assetId: null }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const warehouses = { findOne: vi.fn().mockResolvedValue({ _id: newWarehouseId }) };
    const movementCollection = { insertOne: vi.fn().mockResolvedValue({ insertedId: expenseId }) };
    const session = {
      withTransaction: vi.fn(async (callback: () => Promise<void>) => callback()),
      endSession: vi.fn().mockResolvedValue(undefined),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'trucks') return truckCollection;
        if (name === 'warehouses') return warehouses;
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
