import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ClientSession, Document as MongoDocument } from 'mongodb';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { CompaniesService } from '../companies/companies.service.js';
import { ERP_COLLECTIONS } from '../database/erp-collections.js';

type ExpenseFilters = {
  from?: string;
  to?: string;
  category?: string;
  truckId?: string;
  tripId?: string;
  paymentStatus?: string;
};

type WarehouseSummary = {
  warehouseId: Types.ObjectId;
  stockKg: number;
  inventoryValue: number;
  batchCount: number;
};

const COMPANY_COLLECTIONS = new Set<string>(
  ERP_COLLECTIONS.filter((collection) => collection !== 'users'),
);
const SENSITIVE_FIELD = /password|secret|token|credential|private.?key|authorization|clerkuserid/i;
const RESERVED_FIELDS = new Set([
  '_id',
  'companyId',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'baseAmount',
  'exchangeRate',
]);
const REFERENCE_COLLECTIONS: Record<string, string> = {
  warehouseId: 'warehouses',
  destinationWarehouseId: 'warehouses',
  fromWarehouseId: 'warehouses',
  toWarehouseId: 'warehouses',
  truckId: 'trucks',
  tripId: 'trips',
  driverId: 'accounts',
  lotId: 'cocoaLots',
  assetId: 'assets',
  supplierId: 'suppliers',
  customerId: 'customers',
  purchaseOrderId: 'purchaseOrders',
  purchaseId: 'purchases',
  salesOrderId: 'salesOrders',
  saleId: 'sales',
  shipmentId: 'sales',
  expenseId: 'expenses',
  truckExpenseId: 'truckExpenses',
  supplierPaymentId: 'supplierPayments',
  supplierAdvanceId: 'supplierAdvances',
  customerPaymentId: 'customerPayments',
  customerAdvanceId: 'customerAdvances',
  assetDepreciationId: 'assetDepreciations',
  truckDisposalId: 'truckDisposals',
  documentId: 'documents',
  currencyId: 'currencies',
  productId: 'products',
  materialId: 'materials',
  journalEntryId: 'journalEntries',
};
const DECIMAL_FIELDS = new Set([
  'amount',
  'baseAmount',
  'exchangeRate',
  'quantity',
  'quantityKg',
  'quantityOnHand',
  'receivedQuantityKg',
  'remainingQuantityKg',
  'unitCostPerKg',
  'unitCost',
  'inventoryValue',
  'totalAmount',
  'subtotal',
  'taxAmount',
  'discountAmount',
  'freightAmount',
  'landedCost',
  'paidAmount',
  'balance',
  'debit',
  'credit',
  'bookValue',
  'acquisitionCost',
  'residualValue',
  'monthlyDepreciation',
  'transportedQuantityKg',
  'quantityLiters',
  'unitPrice',
  'cost',
  'salePrice',
  'accumulatedDepreciation',
  'depreciationAmount',
  'lowStockThresholdKg',
]);
const REQUIRED_MODULE_FIELDS: Record<string, string[]> = {
  warehouses: ['code', 'name'],
  cocoaLots: [
    'warehouseId',
    'lotNumber',
    'receivedQuantityKg',
    'remainingQuantityKg',
    'unitCostPerKg',
    'inventoryValue',
  ],
  stockMovements: [
    'warehouseId',
    'lotId',
    'movementType',
    'quantityKg',
    'unitCostPerKg',
  ],
  trucks: ['warehouseId', 'name', 'registrationNumber'],
  trips: ['warehouseId', 'truckId', 'status'],
  expenses: [
    'warehouseId',
    'category',
    'costCenterType',
    'costCenterId',
    'amount',
    'currencyCode',
  ],
  truckExpenses: [
    'warehouseId',
    'truckId',
    'category',
    'amount',
    'currencyCode',
  ],
  fuelLogs: ['truckId', 'quantityLiters', 'unitPrice', 'currencyCode'],
  maintenance: ['warehouseId', 'truckId', 'description'],
  materials: ['warehouseId', 'name', 'quantityOnHand', 'unitCost'],
  materialMovements: ['warehouseId', 'materialId', 'movementType', 'quantity'],
};
const DEFAULT_EXPENSE_CATEGORIES = [
  { code: 'FUEL', name: 'Fuel' },
  { code: 'MAINTENANCE', name: 'Maintenance' },
  { code: 'REPAIRS', name: 'Repairs' },
  { code: 'TRANSPORT', name: 'Transport' },
  { code: 'LOADING', name: 'Loading' },
  { code: 'STORAGE', name: 'Storage' },
  { code: 'LABOR', name: 'Labor' },
  { code: 'QUALITY', name: 'Quality' },
  { code: 'INSURANCE', name: 'Insurance' },
  { code: 'UTILITIES', name: 'Utilities' },
  { code: 'SUPPLIES', name: 'Supplies' },
  { code: 'OTHER', name: 'Other' },
] as const;
const ENUM_FIELDS: Record<string, Record<string, string[]>> = {
  cocoaLots: { status: ['available', 'depleted', 'quarantined'] },
  stockMovements: { movementType: ['incoming', 'outgoing', 'transfer'] },
  trucks: { status: ['active', 'inactive', 'sold', 'disposed'] },
  trips: { status: ['pending', 'active', 'completed', 'cancelled'] },
  expenses: {
    costCenterType: ['warehouse', 'truck', 'trip'],
    paymentStatus: ['unpaid', 'partial', 'paid'],
  },
  maintenance: { status: ['scheduled', 'in_progress', 'completed', 'cancelled'] },
  materialMovements: { movementType: ['incoming', 'consumed', 'transfer'] },
};
const ZERO_DECIMAL = Types.Decimal128.fromString('0');
const HISTORICAL_CURRENCY_RATES_URL = 'https://api.frankfurter.dev/v1';
const LATEST_CURRENCY_RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const decimal = (path: string): Record<string, unknown> => ({
  $convert: { input: path, to: 'decimal', onError: ZERO_DECIMAL, onNull: ZERO_DECIMAL },
});

function decimalProductToCents(values: string[]): string {
  let coefficient = 1n;
  let scale = 0;
  for (const value of values) {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
    if (!match) throw new BadRequestException('Expense amount must be a valid non-negative value');
    const fraction = match[2] ?? '';
    coefficient *= BigInt(`${match[1]}${fraction}`);
    scale += fraction.length;
  }
  const roundingScale = scale - 2;
  if (roundingScale > 0) {
    const divisor = 10n ** BigInt(roundingScale);
    coefficient = (coefficient + divisor / 2n) / divisor;
  } else {
    coefficient *= 10n ** BigInt(-roundingScale);
  }
  const digits = coefficient.toString().padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly companies: CompaniesService,
  ) {}

  private get db() {
    const database = this.connection.db;
    if (!database) throw new Error('MongoDB connection is not ready');
    return database;
  }

  private companyObjectId(companyId: string): Types.ObjectId {
    return new Types.ObjectId(companyId);
  }

  private companyCollectionName(collectionName: string): string {
    const collection = ERP_COLLECTIONS.find(
      (candidate) =>
        candidate !== 'users' &&
        candidate.toLowerCase() === collectionName.toLowerCase(),
    );
    if (!collection) throw new NotFoundException('Company data module not found');
    return collection;
  }

  private async companyIdForUser(clerkUserId: string): Promise<Types.ObjectId> {
    return this.companyObjectId(await this.companies.requireCompanyId(clerkUserId));
  }

  private async count(name: string, companyId: Types.ObjectId, filter: MongoDocument = {}) {
    return this.db.collection(name).countDocuments({ companyId, ...filter });
  }

  private async sum(
    name: string,
    companyId: Types.ObjectId,
    expression: Record<string, unknown>,
    filter: MongoDocument = {},
    includeFuelLogs = false,
  ): Promise<number> {
    const pipeline = name === 'expenses'
      ? this.expensePipeline({ companyId, ...filter }, includeFuelLogs)
      : [{ $match: { companyId, ...filter } }];
    pipeline.push({ $group: { _id: null, total: { $sum: expression } } });
    const [result] = await this.db.collection(name)
      .aggregate<{ total: Types.Decimal128 }>(pipeline)
      .toArray();
    return result?.total ? Number(result.total.toString()) : 0;
  }

  private async warehouseSummaries(companyId: Types.ObjectId): Promise<WarehouseSummary[]> {
    const lots = await this.db.collection('cocoaLots').aggregate<{
      _id: Types.ObjectId;
      stockKg: Types.Decimal128;
      inventoryValue: Types.Decimal128;
      batchCount: number;
    }>([
      { $match: { companyId, warehouseId: { $type: 'objectId' } } },
      {
        $addFields: {
          _remainingKg: decimal('$remainingQuantityKg'),
          _unitCost: decimal('$unitCostPerKg'),
          _storedValue: {
            $convert: {
              input: '$inventoryValue',
              to: 'decimal',
              onError: null,
              onNull: null,
            },
          },
        },
      },
      {
        $group: {
          _id: '$warehouseId',
          stockKg: { $sum: '$_remainingKg' },
          inventoryValue: {
            $sum: {
              $ifNull: ['$_storedValue', { $multiply: ['$_remainingKg', '$_unitCost'] }],
            },
          },
          batchCount: {
            $sum: { $cond: [{ $gt: ['$_remainingKg', ZERO_DECIMAL] }, 1, 0] },
          },
        },
      },
    ]).toArray();
    return lots.map((lot) => ({
      warehouseId: lot._id,
      stockKg: Number(lot.stockKg?.toString() ?? 0),
      inventoryValue: Number(lot.inventoryValue?.toString() ?? 0),
      batchCount: lot.batchCount,
    }));
  }

  private async expenseGroups(
    companyId: Types.ObjectId,
    groupField: string,
    filters: ExpenseFilters & { warehouseId?: Types.ObjectId } = {},
    currencyCode = 'USD',
    includeFuelLogs = false,
  ) {
    const match: MongoDocument = { companyId };
    if (filters.warehouseId) match.warehouseId = filters.warehouseId;
    if (filters.category) match.category = filters.category;
    if (filters.paymentStatus) match.paymentStatus = filters.paymentStatus;
    if (filters.truckId) match.truckId = this.validObjectId(filters.truckId, 'truckId');
    if (filters.tripId) match.tripId = this.validObjectId(filters.tripId, 'tripId');
    const occurredAt: MongoDocument = {};
    if (filters.from) occurredAt.$gte = this.parseDate(filters.from, 'from');
    if (filters.to) {
      const end = this.parseDate(filters.to, 'to');
      end.setUTCHours(23, 59, 59, 999);
      occurredAt.$lte = end;
    }
    if (Object.keys(occurredAt).length) match.incurredAt = occurredAt;

    return this.db.collection('expenses').aggregate<{
      _id: string | null;
      total: Types.Decimal128;
      count: number;
    }>([
      ...this.expensePipeline(match, includeFuelLogs),
      {
        $group: {
          _id: `$${groupField}`,
          total: { $sum: this.companyExpenseAmount(currencyCode) },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]).toArray();
  }

  async getCompanyDashboard(clerkUserId: string) {
    const companyId = await this.companyIdForUser(clerkUserId);
    const currencyCode = await this.companyCurrency(companyId);
    const legacyConversion = await this.convertUnconvertedCompanyExpenses(
      clerkUserId,
    );
    const activeWarehouseFilter = { status: { $ne: 'archived' } };
    const currentTruckFilter = { status: { $nin: ['sold', 'disposed', 'deleted'] } };
    const currentAssetFilter = { status: { $nin: ['sold', 'disposed', 'deleted'] } };
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [
      warehouses,
      lots,
      activeTrucks,
      totalTrucks,
      activeTrips,
      pendingTrips,
      completedTrips,
      totalTrips,
      transportedKg,
      totalExpenses,
      monthlyExpenses,
      expenseByCategory,
      expenseByTruck,
      expenseByTrip,
      purchases,
      sales,
      suppliers,
      customers,
      fixedAssets,
      assetValue,
      materials,
      monthlyExpenseTrend,
    ] = await Promise.all([
      this.db.collection('warehouses')
        .find({ companyId, ...activeWarehouseFilter })
        .sort({ name: 1 })
        .toArray(),
      this.warehouseSummaries(companyId),
      this.count('trucks', companyId, { status: 'active' }),
      this.count('trucks', companyId, currentTruckFilter),
      this.count('trips', companyId, { status: { $in: ['active', 'in_progress'] } }),
      this.count('trips', companyId, { status: 'pending' }),
      this.count('trips', companyId, { status: 'completed' }),
      this.count('trips', companyId),
      this.sum('trips', companyId, decimal('$transportedQuantityKg'), { status: { $ne: 'cancelled' } }),
      this.sum('expenses', companyId, this.companyExpenseAmount(currencyCode), {}, true),
      this.sum('expenses', companyId, this.companyExpenseAmount(currencyCode), { incurredAt: { $gte: monthStart, $lte: new Date() } }, true),
      this.expenseGroups(companyId, 'category', {}, currencyCode, true),
      this.expenseGroups(companyId, 'truckId', {}, currencyCode, true),
      this.expenseGroups(companyId, 'tripId', {}, currencyCode, true),
      this.count('purchases', companyId),
      this.count('sales', companyId),
      this.count('suppliers', companyId),
      this.count('customers', companyId),
      this.count('assets', companyId, currentAssetFilter),
      this.assetBookValue(companyId),
      this.count('materials', companyId),
      this.monthlyExpenseTrend(companyId, currencyCode, true),
    ]);

    const trucksOnTrip = await this.db.collection('trips').distinct('truckId', {
      companyId,
      status: { $in: ['active', 'in_progress'] },
      truckId: { $type: 'objectId' },
    });
    const unconvertedExpenseCount = await this.unconvertedExpenseCount(companyId, currencyCode, {}, true);
    const operationalVsTransportation = await this.operationalVsTransportation(companyId, currencyCode, true);
    const warehouseStats = new Map(
      lots.map((summary) => [summary.warehouseId.toString(), summary]),
    );
    const [trucksByWarehouse, tripsByWarehouse, expensesByWarehouse] = await Promise.all([
      this.groupCountsByWarehouse(companyId, 'trucks', currentTruckFilter),
      this.groupCountsByWarehouse(companyId, 'trips', {}),
      this.expensesByWarehouse(companyId, currencyCode),
    ]);
    const truckStats = new Map(trucksByWarehouse.map((item) => [item.id, item]));
    const tripStats = new Map(tripsByWarehouse.map((item) => [item.id, item]));
    const expenseStats = new Map(expensesByWarehouse.map((item) => [item.id, item]));
    const warehouseRows = warehouses.map((warehouse) => {
      const id = warehouse._id.toString();
      const inventory = warehouseStats.get(id);
      return {
        id,
        code: warehouse.code,
        name: warehouse.name,
        location: warehouse.location ?? '',
        address: warehouse.address ?? '',
        status: warehouse.status,
        stockKg: inventory?.stockKg ?? 0,
        inventoryValue: inventory?.inventoryValue ?? 0,
        batches: inventory?.batchCount ?? 0,
        trucks: truckStats.get(id)?.count ?? 0,
        trips: tripStats.get(id)?.count ?? 0,
        expenses: expenseStats.get(id)?.amount ?? 0,
      };
    });
    const monthlyExpenseTrendRows = monthlyExpenseTrend.map((row) => ({
      month: row._id,
      amount: Number(row.total?.toString() ?? 0),
    }));
    const fuelAndMaintenance = await this.expenseGroupsByCategories(companyId, ['fuel', 'maintenance'], currencyCode, true);

    return {
      generatedAt: new Date().toISOString(),
      currencyCode,
      kpis: {
        warehouses: warehouseRows.length,
        trucks: totalTrucks,
        activeTrucks,
        trucksOnTrip: trucksOnTrip.length,
        availableTrucks: Math.max(activeTrucks - trucksOnTrip.length, 0),
        inventoryStockKg: lots.reduce((total, item) => total + item.stockKg, 0),
        inventoryValue: lots.reduce((total, item) => total + item.inventoryValue, 0),
        inventoryBatches: lots.reduce((total, item) => total + item.batchCount, 0),
        expenses: totalExpenses,
        monthlyExpenses,
        trips: totalTrips,
        activeTrips,
        pendingTrips,
        completedTrips,
        transportedKg,
        purchases,
        sales,
        suppliers,
        customers,
        fixedAssets,
        assetValue,
        materials,
      },
      warehouses: warehouseRows,
      analytics: {
        expenseByCategory: expenseByCategory.map((row) => ({
          label: String(row._id ?? 'other'),
          amount: Number(row.total?.toString() ?? 0),
          count: row.count,
        })),
        expenseByTruck: expenseByTruck.map((row) => ({
          id: row._id?.toString() ?? '',
          amount: Number(row.total?.toString() ?? 0),
          count: row.count,
        })),
        expenseByTrip: expenseByTrip.map((row) => ({
          id: row._id?.toString() ?? '',
          amount: Number(row.total?.toString() ?? 0),
          count: row.count,
        })),
        monthlyExpenses: monthlyExpenseTrendRows,
        fuelAndMaintenance,
        operationalVsTransportation,
      },
      dataAvailability: {
        inventory: 'cocoaLots',
        expenses: 'expenses',
        trips: 'trips',
        trucks: 'trucks',
        purchases: 'purchases',
        sales: 'sales',
        suppliers: 'suppliers',
        customers: 'customers',
        assets: 'assets',
      },
      dataQuality: {
        unconvertedExpenseCount,
        conversionError: legacyConversion.conversionError,
      },
    };
  }

  async getCompanyExpenses(clerkUserId: string, filters: ExpenseFilters = {}) {
    const companyId = await this.companyIdForUser(clerkUserId);
    const currencyCode = await this.companyCurrency(companyId);
    const expenseFilter = this.expenseDocumentFilter(filters);
    const legacyConversion = await this.convertUnconvertedCompanyExpenses(clerkUserId);
    const match = {
      companyId,
      ...expenseFilter,
    };
    const [total, records, countRows] = await Promise.all([
      this.sum('expenses', companyId, this.companyExpenseAmount(currencyCode), expenseFilter, true),
      this.db.collection('expenses').aggregate([
        ...this.expensePipeline(match, true),
        { $sort: { incurredAt: -1 } },
        { $limit: 200 },
      ]).toArray(),
      this.db.collection('expenses').aggregate<{ count: number }>([
        ...this.expensePipeline(match, true),
        { $count: 'count' },
      ]).toArray(),
    ]);
    const count = countRows[0]?.count ?? 0;
    return {
      total,
      count,
      limit: 200,
      currencyCode,
      unconvertedCount: await this.unconvertedExpenseCount(companyId, currencyCode, filters, true),
      conversionError: legacyConversion.conversionError,
      records: records.map((expense) => ({
        id: expense._id.toString(),
        category: expense.category,
        amount: Number(expense.amount?.toString() ?? 0),
        currencyCode: expense.currencyCode,
        paymentStatus: expense.paymentStatus,
        incurredAt: expense.incurredAt,
        warehouseId: expense.warehouseId?.toString() ?? '',
        truckId: expense.truckId?.toString() ?? null,
        tripId: expense.tripId?.toString() ?? null,
        costCenterType: expense.costCenterType,
        costCenterId: expense.costCenterId?.toString() ?? '',
      })),
    };
  }

  async getCompanyModuleRecords(
    clerkUserId: string,
    collectionName: string,
    warehouseIdInput?: string,
    page = 1,
  ) {
    const companyId = await this.companyIdForUser(clerkUserId);
    collectionName = this.companyCollectionName(collectionName);
    if (collectionName === 'companies') return this.getCompanyProfileById(companyId);

    const filter: MongoDocument = { companyId };
    if (warehouseIdInput) {
      const warehouseId = await this.requireCompanyWarehouseId(companyId, warehouseIdInput);
      filter.warehouseId = warehouseId;
    }

    if (!Number.isInteger(page) || page < 1 || page > 10000) {
      throw new BadRequestException('page must be a positive integer');
    }
    const limit = 50;
    const [total, records] = await Promise.all([
      this.db.collection(collectionName).countDocuments(filter),
      this.db.collection(collectionName)
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
    ]);

    return {
      collection: collectionName,
      total,
      limit,
      page,
      records: records.map((record) => this.sanitizeModuleRecord(record)),
    };
  }

  async getWarehouseModuleRecords(
    clerkUserId: string,
    warehouseIdInput: string,
    collectionName: string,
    page = 1,
  ) {
    const companyId = await this.companyIdForUser(clerkUserId);
    const warehouseId = await this.requireCompanyWarehouseId(companyId, warehouseIdInput);
    collectionName = this.companyCollectionName(collectionName);
    if (!Number.isInteger(page) || page < 1 || page > 10000) {
      throw new BadRequestException('page must be a positive integer');
    }
    const referenceByModule: Record<string, string> = {
      trucks: 'warehouseId',
      trips: 'warehouseId',
      expenses: 'warehouseId',
      truckExpenses: 'warehouseId',
      cocoaLots: 'warehouseId',
      stockMovements: 'warehouseId',
      materials: 'warehouseId',
      materialMovements: 'warehouseId',
      fuelLogs: 'warehouseId',
      maintenance: 'warehouseId',
      assets: 'warehouseId',
      purchases: 'warehouseId',
      sales: 'warehouseId',
      purchaseOrders: 'warehouseId',
      salesOrders: 'warehouseId',
      supplierPayments: 'warehouseId',
      supplierAdvances: 'warehouseId',
      customerPayments: 'warehouseId',
      customerAdvances: 'warehouseId',
    };
    const warehouseField = referenceByModule[collectionName];
    if (!warehouseField) {
      throw new BadRequestException(`${collectionName} records are managed at the company level`);
    }
    const filter: MongoDocument = { companyId, [warehouseField]: warehouseId };
    const limit = 50;
    const [total, records] = await Promise.all([
      this.db.collection(collectionName).countDocuments(filter),
      this.db.collection(collectionName)
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
    ]);
    return {
      collection: collectionName,
      warehouseId: warehouseId.toString(),
      total,
      limit,
      page,
      records: records.map((record) => this.sanitizeModuleRecord(record)),
    };
  }

  async getCompanyModuleOptions(
    clerkUserId: string,
    collectionName: string,
  ) {
    const companyId = await this.companyIdForUser(clerkUserId);
    collectionName = this.companyCollectionName(collectionName);
    if (collectionName === 'expenseCategories') {
      await this.ensureDefaultExpenseCategories(companyId);
    }
    const filter: MongoDocument = { companyId };
    if (collectionName === 'accounts') {
      filter.role = 'driver';
      filter.status = 'active';
    } else if (collectionName === 'expenseCategories') {
      filter.$or = [
        { status: 'active' },
        { status: { $exists: false } },
        { status: null },
      ];
    } else if (collectionName === 'warehouses' || collectionName === 'trucks') {
      filter.status = 'active';
    }
    const options = await this.db.collection(collectionName)
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(500)
      .toArray();
    return options.map((record) => this.sanitizeModuleRecord(record));
  }

  private async ensureDefaultExpenseCategories(companyId: Types.ObjectId): Promise<void> {
    const categories = this.db.collection('expenseCategories');
    const existing = await categories.find(
      { companyId },
      { projection: { name: 1, code: 1 } },
    ).toArray();
    const names = new Set(
      existing
        .filter((category) => typeof category.name === 'string')
        .map((category) => category.name.trim().toLowerCase()),
    );
    const codes = new Set(
      existing
        .filter((category) => typeof category.code === 'string')
        .map((category) => category.code.trim().toUpperCase()),
    );
    const missing = DEFAULT_EXPENSE_CATEGORIES.filter((category) =>
      !names.has(category.name.toLowerCase()) && !codes.has(category.code),
    );
    const now = new Date();
    await Promise.all(missing.map((category) => categories.updateOne(
      { companyId, code: category.code },
      {
        $setOnInsert: {
          companyId,
          ...category,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    )));
  }

  async createCompanyModuleRecord(
    clerkUserId: string,
    collectionName: string,
    input: Record<string, unknown>,
    warehouseIdInput?: string,
  ) {
    const companyId = await this.companyIdForUser(clerkUserId);
    collectionName = this.companyCollectionName(collectionName);
    this.assertModuleWritable(collectionName);
    let warehouseId = warehouseIdInput && this.supportsWarehouseRecords(collectionName)
      ? await this.requireCompanyWarehouseId(companyId, warehouseIdInput)
      : undefined;
    if (!warehouseId && this.supportsWarehouseRecords(collectionName) && typeof input.warehouseId === 'string') {
      warehouseId = await this.requireCompanyWarehouseId(companyId, input.warehouseId);
    }
    const truckWarehouseId = await this.truckLinkedWarehouseId(companyId, collectionName, input);
    if (truckWarehouseId) {
      if (warehouseId && !warehouseId.equals(truckWarehouseId)) {
        throw new BadRequestException('Truck expenses must be assigned to the truck’s warehouse');
      }
      warehouseId = truckWarehouseId;
    }
    const record = this.prepareModuleRecord(
      warehouseId ? { ...input, warehouseId } : input,
      collectionName,
      true,
    );
    const normalized = await this.normalizeModuleRecord(record, companyId);
    this.normalizeModuleSpecificValues(collectionName, normalized, true);
    await this.addBaseCurrencyAmount(companyId, collectionName, normalized);
    const now = new Date();
    const created = {
      ...normalized,
      companyId,
      createdAt: now,
      updatedAt: now,
    };
    let result: { insertedId: Types.ObjectId };
    try {
      result = await this.db.collection(collectionName).insertOne(created);
    } catch (error) {
      this.throwDuplicateConflict(error);
      throw error;
    }
    const saved = await this.db.collection(collectionName).findOne({
      _id: result.insertedId,
      companyId,
    });
    if (!saved) throw new Error('Created record could not be reloaded');
    if (collectionName === 'trucks') {
      await this.syncDriverWarehouseAssignments(companyId, [saved.driverId]);
    }
    return this.sanitizeModuleRecord(saved);
  }

  async updateCompanyModuleRecord(
    clerkUserId: string,
    collectionName: string,
    recordIdInput: string,
    input: Record<string, unknown>,
    warehouseIdInput?: string,
  ) {
    const companyId = await this.companyIdForUser(clerkUserId);
    collectionName = this.companyCollectionName(collectionName);
    if (collectionName === 'companies') {
      return this.updateCompanyProfile(companyId, recordIdInput, input);
    }
    this.assertModuleWritable(collectionName);
    const recordId = this.validObjectId(recordIdInput, 'recordId');
    const warehouseId = warehouseIdInput && this.supportsWarehouseRecords(collectionName)
      ? await this.requireCompanyWarehouseId(companyId, warehouseIdInput)
      : undefined;
    const record = this.prepareModuleRecord(input, collectionName, false);
    const needsExistingRecord = Boolean(warehouseId) ||
      collectionName === 'trucks' ||
      collectionName === 'expenses' ||
      collectionName === 'fuelLogs' ||
      this.isTruckLinkedRecord(collectionName, record);
    const existing = needsExistingRecord
      ? await this.db.collection(collectionName).findOne({
        _id: recordId,
        companyId,
        ...(warehouseId ? { warehouseId } : {}),
      }, {
        projection: {
          _id: 1,
          warehouseId: 1,
          truckId: 1,
          costCenterType: 1,
          costCenterId: 1,
          driverId: 1,
        },
      })
      : null;
    if (needsExistingRecord && !existing) {
      throw new NotFoundException(warehouseId
        ? 'Company record not found in this warehouse'
        : 'Company record not found');
    }
    const effectiveRecord = { ...existing, ...record };
    const truckLinked = this.isTruckLinkedRecord(collectionName, effectiveRecord);
    if (truckLinked) {
      const linkedWarehouseId = await this.truckLinkedWarehouseId(
        companyId,
        collectionName,
        effectiveRecord,
        existing ?? undefined,
      );
      if (linkedWarehouseId) {
        if (warehouseId && !warehouseId.equals(linkedWarehouseId)) {
          throw new BadRequestException('Truck expenses must be assigned to the truck’s warehouse');
        }
        if (typeof record.warehouseId === 'string') {
          const requestedWarehouseId = await this.requireCompanyWarehouseId(companyId, record.warehouseId);
          if (!requestedWarehouseId.equals(linkedWarehouseId)) {
            throw new BadRequestException('Truck expenses must be assigned to the truck’s warehouse');
          }
        }
        record.warehouseId = linkedWarehouseId;
      }
    }
    if (warehouseId && 'warehouseId' in record) {
      const requestedWarehouseId = this.validObjectId(String(record.warehouseId), 'warehouseId');
      if (!requestedWarehouseId.equals(warehouseId)) {
        throw new BadRequestException('Warehouse assignment cannot be changed from this warehouse view');
      }
    }
    if (warehouseId) delete record.warehouseId;
    const normalized = await this.normalizeModuleRecord(record, companyId);
    this.normalizeModuleSpecificValues(collectionName, normalized);
    if (
      ['expenses', 'truckExpenses', 'fuelLogs'].includes(collectionName) &&
      ['amount', 'quantityLiters', 'unitPrice', 'currencyCode'].some((field) => field in normalized)
    ) {
      const current = await this.db.collection(collectionName).findOne(
        { _id: recordId, companyId },
        { projection: { amount: 1, quantityLiters: 1, unitPrice: 1, currencyCode: 1 } },
      );
      if (!current) throw new NotFoundException('Company record not found');
      const conversionRecord = { ...current, ...normalized };
      await this.addBaseCurrencyAmount(companyId, collectionName, conversionRecord);
      normalized.baseAmount = conversionRecord.baseAmount;
      normalized.exchangeRate = conversionRecord.exchangeRate;
    }
    let result: { matchedCount: number };
    try {
      result = await this.db.collection(collectionName).updateOne(
        { _id: recordId, companyId, ...(warehouseId ? { warehouseId } : {}) },
        { $set: { ...normalized, updatedAt: new Date() } },
      );
    } catch (error) {
      this.throwDuplicateConflict(error);
      throw error;
    }
    if (result.matchedCount === 0) throw new NotFoundException('Company record not found');
    const updated = await this.db.collection(collectionName).findOne({
      _id: recordId,
      companyId,
      ...(warehouseId ? { warehouseId } : {}),
    });
    if (!updated) throw new Error('Updated record could not be reloaded');
    if (collectionName === 'trucks') {
      await this.syncDriverWarehouseAssignments(companyId, [existing?.driverId, updated.driverId]);
    }
    return this.sanitizeModuleRecord(updated);
  }

  async deleteCompanyModuleRecord(
    clerkUserId: string,
    collectionName: string,
    recordIdInput: string,
    warehouseIdInput?: string,
  ) {
    const companyId = await this.companyIdForUser(clerkUserId);
    collectionName = this.companyCollectionName(collectionName);
    this.assertModuleWritable(collectionName);
    const recordId = this.validObjectId(recordIdInput, 'recordId');
    const warehouseId = warehouseIdInput && this.supportsWarehouseRecords(collectionName)
      ? await this.requireCompanyWarehouseId(companyId, warehouseIdInput)
      : undefined;
    const collection = this.db.collection(collectionName);
    const exists = await collection.findOne(
      { _id: recordId, companyId, ...(warehouseId ? { warehouseId } : {}) },
      { projection: collectionName === 'trucks' ? { _id: 1, driverId: 1 } : { _id: 1 } },
    );
    if (!exists) throw new NotFoundException('Company record not found');

    const referenceIds = [recordId, recordId.toString()];
    const referenceFields = Object.entries(REFERENCE_COLLECTIONS)
      .filter(([, targetCollection]) => targetCollection === collectionName)
      .map(([field]) => field);
    const costCenterType = { warehouses: 'warehouse', trucks: 'truck', trips: 'trip' }[collectionName];
    for (const referencingCollection of COMPANY_COLLECTIONS) {
      const references = [
        ...referenceFields.map((field) => ({ [field]: { $in: referenceIds } })),
        ...(costCenterType
          ? [{ costCenterType, costCenterId: { $in: referenceIds } }]
          : []),
      ];
      if (references.length === 0) break;
      const reference = await this.db.collection(referencingCollection).findOne({
        companyId,
        $or: references,
      }, { projection: { _id: 1 } });
      if (reference) {
        throw new ConflictException(
          'This record is linked to other company records. Remove or update those links before deleting it.',
        );
      }
    }

    await collection.deleteOne({ _id: recordId, companyId, ...(warehouseId ? { warehouseId } : {}) });
    if (collectionName === 'trucks') {
      await this.syncDriverWarehouseAssignments(companyId, [exists.driverId]);
    }
    return { deleted: true, id: recordId.toString() };
  }

  async getCompanyProfile(clerkUserId: string) {
    const companyId = await this.companyIdForUser(clerkUserId);
    return this.getCompanyProfileById(companyId);
  }

  private async getCompanyProfileById(companyId: Types.ObjectId) {
    const company = await this.db.collection('companies').findOne({
      _id: companyId,
    });
    if (!company) throw new NotFoundException('Company not found');
    return {
      collection: 'companies',
      total: 1,
      limit: 1,
      records: [this.sanitizeModuleRecord(company)],
    };
  }

  async updateCompanyPreferences(
    clerkUserId: string,
    input: Record<string, unknown>,
  ) {
    const companyId = await this.companyIdForUser(clerkUserId);
    return this.updateCompanyProfile(companyId, companyId.toString(), input);
  }

  async convertUnconvertedCompanyExpenses(clerkUserId: string) {
    const companyId = await this.companyIdForUser(clerkUserId);
    const baseCurrencyCode = await this.companyCurrency(companyId);
    const batchLimit = 500;
    const exchangeRates = new Map<string, number>();
    let convertedCount = 0;
    let conversionError: string | undefined;

    for (const collectionName of ['expenses', 'truckExpenses', 'fuelLogs']) {
      const records = await this.db.collection(collectionName)
        .find({
          companyId,
          currencyCode: { $ne: baseCurrencyCode },
          $or: [{ baseAmount: null }, { baseAmount: { $exists: false } }],
          ...(collectionName === 'fuelLogs' ? { expenseId: null } : {}),
        })
        .sort({ [collectionName === 'fuelLogs' ? 'occurredAt' : 'incurredAt']: 1 })
        .limit(batchLimit)
        .toArray();

      for (const record of records) {
        const currencyCode = String(record.currencyCode ?? '').toUpperCase();
        const transactionDate = record[
          collectionName === 'fuelLogs' ? 'occurredAt' : 'incurredAt'
        ];
        if (!(transactionDate instanceof Date) || Number.isNaN(transactionDate.getTime())) {
          throw new BadRequestException(
            `Cannot convert ${collectionName} record ${record._id}: transaction date is invalid`,
          );
        }
        const date = transactionDate.toISOString().slice(0, 10);
        const cacheKey = `${date}:${currencyCode}:${baseCurrencyCode}`;
        let exchangeRate = exchangeRates.get(cacheKey);
        if (exchangeRate === undefined) {
          try {
            exchangeRate = await this.historicalCurrencyConversionRate(
              currencyCode,
              baseCurrencyCode,
              date,
            );
            exchangeRates.set(cacheKey, exchangeRate);
          } catch (cause) {
            if (
              cause instanceof ServiceUnavailableException ||
              cause instanceof BadRequestException
            ) {
              conversionError ??= cause.message;
              continue;
            }
            throw cause;
          }
        }
        const amountValues = collectionName === 'fuelLogs'
          ? [String(record.quantityLiters), String(record.unitPrice)]
          : [String(record.amount)];
        const baseAmount = decimalProductToCents([
          ...amountValues,
          exchangeRate.toFixed(10),
        ]);
        const update = await this.db.collection(collectionName).updateOne(
          {
            _id: record._id,
            companyId,
            currencyCode: record.currencyCode,
            baseAmount: null,
            ...(collectionName === 'fuelLogs'
              ? {
                quantityLiters: record.quantityLiters,
                unitPrice: record.unitPrice,
                expenseId: null,
              }
              : { amount: record.amount }),
          },
          {
            $set: {
              baseAmount: Types.Decimal128.fromString(baseAmount),
              exchangeRate: Types.Decimal128.fromString(exchangeRate.toFixed(10)),
              updatedAt: new Date(),
            },
          },
        );
        convertedCount += update.modifiedCount;
      }
    }

    return {
      convertedCount,
      remainingCount: await this.unconvertedExpenseCount(companyId, baseCurrencyCode, {}, true),
      limit: batchLimit,
      conversionError,
    };
  }

  async getWarehouseOverview(
    clerkUserId: string,
    warehouseIdInput: string,
    filters: ExpenseFilters = {},
  ) {
    const companyId = await this.companyIdForUser(clerkUserId);
    const warehouseId = this.validObjectId(warehouseIdInput, 'warehouseId');
    const warehouse = await this.db.collection('warehouses').findOne({
      _id: warehouseId,
      companyId,
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const expenseMatch: ExpenseFilters & { warehouseId: Types.ObjectId } = {
      ...filters,
      warehouseId,
    };
    const currencyCode = await this.companyCurrency(companyId);
    const [
      stockSummary,
      batches,
      movementSummary,
      trucks,
      trips,
      expenseGroups,
      expenses,
      materialCount,
      materialMovementCount,
      materials,
      materialMovementSummary,
      purchasingSalesSummary,
    ] = await Promise.all([
      this.warehouseSummaries(companyId),
      this.db.collection('cocoaLots').find({
        companyId,
        warehouseId,
        status: { $ne: 'depleted' },
      }).sort({ lotNumber: 1 }).toArray(),
      this.db.collection('stockMovements').aggregate<{
        _id: string;
        quantity: Types.Decimal128;
        count: number;
      }>([
        { $match: { companyId, warehouseId } },
        {
          $group: {
            _id: '$movementType',
            quantity: { $sum: decimal('$quantityKg') },
            count: { $sum: 1 },
          },
        },
      ]).toArray(),
      this.db.collection('trucks').find({
        companyId,
        warehouseId,
        status: { $nin: ['sold', 'disposed', 'deleted'] },
      }).sort({ registrationNumber: 1 }).toArray(),
      this.db.collection('trips').find({
        companyId,
        warehouseId,
      }).sort({ createdAt: -1 }).toArray(),
      this.expenseGroups(companyId, 'category', expenseMatch, currencyCode, true),
      this.db.collection('expenses').aggregate([
        ...this.expensePipeline({
          companyId,
          warehouseId,
          ...this.expenseDocumentFilter(filters),
        }, true),
        { $sort: { incurredAt: -1 } },
        { $limit: 200 },
      ]).toArray(),
      this.count('materials', companyId, { warehouseId }),
      this.count('materialMovements', companyId, { warehouseId }),
      this.db.collection('materials').find({ companyId, warehouseId })
        .sort({ name: 1 })
        .toArray(),
      this.db.collection('materialMovements').aggregate<{
        _id: string;
        quantity: Types.Decimal128;
        count: number;
      }>([
        { $match: { companyId, warehouseId } },
        {
          $group: {
            _id: '$movementType',
            quantity: { $sum: decimal('$quantity') },
            count: { $sum: 1 },
          },
        },
      ]).toArray(),
      this.warehouseBusinessCounts(companyId, warehouseId),
    ]);

    const inventory = stockSummary.find((item) => item.warehouseId.equals(warehouseId));
    const [tripsInProgress, activeTrucks, expenseTotal, truckExpensesByTruck, monthExpense, maintenanceExpense, fuelExpense] = await Promise.all([
      this.db.collection('trips').distinct('truckId', {
        companyId,
        warehouseId,
        status: { $in: ['active', 'in_progress'] },
        truckId: { $type: 'objectId' },
      }),
      this.count('trucks', companyId, { warehouseId, status: 'active' }),
      this.sum('expenses', companyId, this.companyExpenseAmount(currencyCode), {
        warehouseId,
        ...this.expenseDocumentFilter(filters),
      }, true),
      this.expenseGroups(companyId, 'truckId', expenseMatch, currencyCode, true),
      this.sum('expenses', companyId, this.companyExpenseAmount(currencyCode), {
        warehouseId,
        incurredAt: { $gte: this.utcMonthStart(), $lte: new Date() },
      }, true),
      this.sum('expenses', companyId, this.companyExpenseAmount(currencyCode), {
        warehouseId,
        category: 'maintenance',
        incurredAt: { $gte: this.utcMonthStart(), $lte: new Date() },
      }, true),
      this.sum('expenses', companyId, this.companyExpenseAmount(currencyCode), {
        warehouseId,
        category: 'fuel',
        incurredAt: { $gte: this.utcMonthStart(), $lte: new Date() },
      }, true),
    ]);
    const expenseByTruck = new Map(
      truckExpensesByTruck.map((row) => [row._id?.toString() ?? '', Number(row.total?.toString() ?? 0)]),
    );
    const driverIds = [...new Set(
      [...trucks, ...trips]
        .map((record) => record.driverId?.toString())
        .filter((id): id is string => !!id && Types.ObjectId.isValid(id)),
    )].map((id) => new Types.ObjectId(id));
    const drivers = driverIds.length
      ? await this.db.collection('accounts')
        .find({ _id: { $in: driverIds }, companyId })
        .project({ name: 1, employeeNumber: 1 })
        .toArray()
      : [];
    const driverById = new Map(drivers.map((driver) => [driver._id.toString(), driver]));
    const truckById = new Map(trucks.map((truck) => [truck._id.toString(), truck]));
    const activeTripStatuses = new Set(['active', 'in_progress']);
    const tripCountByStatus = (status: string) =>
      trips.filter((trip) => trip.status === status).length;
    const lowStockThreshold = warehouse.lowStockThresholdKg
      ? Number(warehouse.lowStockThresholdKg.toString())
      : null;
    const totalStockKg = inventory?.stockKg ?? 0;
    const avgCost = totalStockKg > 0
      ? (inventory?.inventoryValue ?? 0) / totalStockKg
      : 0;

    return {
      warehouse: {
        id: warehouseId.toString(),
        name: warehouse.name,
        code: warehouse.code,
        location: warehouse.location ?? '',
        address: warehouse.address ?? '',
        status: warehouse.status,
        createdAt: warehouse.createdAt ?? null,
        lowStockThresholdKg: lowStockThreshold,
      },
      currencyCode,
      inventory: {
        stockKg: totalStockKg,
        batchCount: inventory?.batchCount ?? 0,
        inventoryValue: inventory?.inventoryValue ?? 0,
        weightedAverageCostPerKg: avgCost,
        lowStockBatchCount: lowStockThreshold === null
          ? null
          : batches.filter((batch) => Number(batch.remainingQuantityKg?.toString() ?? 0) <= lowStockThreshold).length,
        batches: batches.map((batch) => ({
          id: batch._id.toString(),
          lotNumber: batch.lotNumber,
          quantityKg: Number(batch.remainingQuantityKg?.toString() ?? 0),
          unitCostPerKg: Number(batch.unitCostPerKg?.toString() ?? 0),
          inventoryValue: Number(batch.inventoryValue?.toString() ?? 0),
          status: batch.status,
        })),
        movements: movementSummary.map((movement) => ({
          type: movement._id,
          quantityKg: Number(movement.quantity?.toString() ?? 0),
          count: movement.count,
        })),
      },
      expenses: {
        total: expenseTotal,
        unconvertedCount: await this.unconvertedExpenseCount(companyId, currencyCode, {
          ...filters,
          warehouseId,
        }, true),
        currencyCode,
        monthly: monthExpense,
        monthlyFuel: fuelExpense,
        monthlyMaintenance: maintenanceExpense,
        byCategory: expenseGroups.map((row) => ({
          category: row._id ?? 'other',
          amount: Number(row.total?.toString() ?? 0),
          count: row.count,
        })),
        records: expenses.map((expense) => ({
          id: expense._id.toString(),
          category: expense.category,
          amount: Number(expense.amount?.toString() ?? 0),
          currencyCode: expense.currencyCode,
          paymentStatus: expense.paymentStatus,
          incurredAt: expense.incurredAt,
          truckId: expense.truckId?.toString() ?? null,
          tripId: expense.tripId?.toString() ?? null,
          costCenterType: expense.costCenterType,
          costCenterId: expense.costCenterId?.toString() ?? null,
        })),
        filtersApplied: filters,
        limit: 200,
      },
      trucks: {
        total: trucks.length,
        active: activeTrucks,
        inactive: trucks.filter((truck) => truck.status === 'inactive').length,
        onTrip: tripsInProgress.length,
        available: Math.max(activeTrucks - tripsInProgress.length, 0),
        monthlyFuel: fuelExpense,
        monthlyMaintenance: maintenanceExpense,
        records: trucks.map((truck) => ({
          id: truck._id.toString(),
          name: truck.name,
          registrationNumber: truck.registrationNumber,
          status: truck.status,
          driverId: truck.driverId?.toString() ?? null,
          driverName: truck.driverId ? driverById.get(truck.driverId.toString())?.name ?? null : null,
          expenseTotal: expenseByTruck.get(truck._id.toString()) ?? 0,
        })),
      },
      trips: {
        total: trips.length,
        completed: tripCountByStatus('completed'),
        active: trips.filter((trip) => activeTripStatuses.has(trip.status)).length,
        pending: tripCountByStatus('pending'),
        cancelled: tripCountByStatus('cancelled'),
        transportedKg: trips.reduce(
          (total, trip) => total + (
            trip.status === 'cancelled'
              ? 0
              : Number(trip.transportedQuantityKg?.toString() ?? 0)
          ),
          0,
        ),
        records: trips.map((trip) => ({
          id: trip._id.toString(),
          truckId: trip.truckId?.toString() ?? null,
          truckName: trip.truckId ? truckById.get(trip.truckId.toString())?.name ?? null : null,
          driverId: trip.driverId?.toString() ?? null,
          driverName: trip.driverId ? driverById.get(trip.driverId.toString())?.name ?? null : null,
          shipmentId: trip.shipmentId?.toString() ?? null,
          status: trip.status,
          transportedQuantityKg: Number(trip.transportedQuantityKg?.toString() ?? 0),
          startedAt: trip.startedAt ?? null,
          completedAt: trip.completedAt ?? null,
        })),
      },
      materials: {
        count: materialCount,
        movements: materialMovementCount,
        records: materials.map((material) => ({
          id: material._id.toString(),
          name: material.name,
          quantityOnHand: Number(material.quantityOnHand?.toString() ?? 0),
          unitCost: Number(material.unitCost?.toString() ?? 0),
          inventoryValue:
            Number(material.quantityOnHand?.toString() ?? 0) *
            Number(material.unitCost?.toString() ?? 0),
        })),
        movementSummary: materialMovementSummary.map((movement) => ({
          type: movement._id,
          quantity: Number(movement.quantity?.toString() ?? 0),
          count: movement.count,
        })),
      },
      operations: purchasingSalesSummary,
    };
  }

  private async warehouseBusinessCounts(
    companyId: Types.ObjectId,
    warehouseId: Types.ObjectId,
  ) {
    const collections = [
      'purchases',
      'purchaseOrders',
      'sales',
      'salesOrders',
      'supplierPayments',
      'supplierAdvances',
      'customerPayments',
      'customerAdvances',
    ] as const;
    const counts = await Promise.all(collections.map((name) =>
      this.db.collection(name).countDocuments({ companyId, warehouseId }),
    ));
    return Object.fromEntries(collections.map((name, index) => [name, counts[index] ?? 0]));
  }

  async transferTruck(
    clerkUserId: string,
    truckIdInput: string,
    warehouseIdInput: string,
  ) {
    const companyId = await this.companyIdForUser(clerkUserId);
    const truckId = this.validObjectId(truckIdInput, 'truckId');
    const targetWarehouseId = this.validObjectId(warehouseIdInput, 'warehouseId');
    const session = await this.connection.startSession();
    const movedAt = new Date();
    try {
      await session.withTransaction(async () => {
        const truck = await this.db.collection('trucks').findOne(
          {
            _id: truckId,
            companyId,
            status: { $nin: ['sold', 'disposed', 'deleted'] },
          },
          { session },
        );
        if (!truck) throw new NotFoundException('Active company truck not found');
        if (!truck.warehouseId || typeof truck.warehouseId.equals !== 'function') {
          throw new BadRequestException('Truck has no valid current warehouse assignment');
        }
        if (truck.warehouseId?.equals(targetWarehouseId)) {
          throw new BadRequestException('Truck is already assigned to this warehouse');
        }
        const targetWarehouse = await this.db.collection('warehouses').findOne(
          {
            _id: targetWarehouseId,
            companyId,
            status: 'active',
          },
          { session },
        );
        if (!targetWarehouse) throw new NotFoundException('Active warehouse not found');

        const update = await this.db.collection('trucks').updateOne(
          { _id: truckId, companyId, warehouseId: truck.warehouseId },
          { $set: { warehouseId: targetWarehouseId, updatedAt: movedAt } },
          { session },
        );
        if (update.matchedCount !== 1) {
          throw new ConflictException('Truck assignment changed; reload and try again');
        }
        if (truck.assetId) {
          const assetUpdate = await this.db.collection('assets').updateOne(
            { _id: truck.assetId, companyId },
            { $set: { warehouseId: targetWarehouseId, updatedAt: movedAt } },
            { session },
          );
          if (assetUpdate.matchedCount !== 1) {
            throw new ConflictException('Truck asset record is missing or belongs to another company');
          }
        }
        await this.db.collection('assetMovements').insertOne(
          {
            companyId,
            assetId: truck.assetId ?? null,
            truckId,
            fromWarehouseId: truck.warehouseId,
            toWarehouseId: targetWarehouseId,
            movementType: 'warehouse_transfer',
            occurredAt: movedAt,
          },
          { session },
        );
        await this.syncDriverWarehouseAssignments(
          companyId,
          [truck.driverId],
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    return {
      truckId: truckId.toString(),
      warehouseId: targetWarehouseId.toString(),
      transferredAt: movedAt.toISOString(),
    };
  }

  private validObjectId(value: string, field: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} must be a valid ID`);
    }
    return new Types.ObjectId(value);
  }

  private assertModuleWritable(collectionName: string) {
    if (!COMPANY_COLLECTIONS.has(collectionName)) {
      throw new NotFoundException('Company data module not found');
    }
    if (collectionName === 'companies') {
      throw new BadRequestException('Update the company profile instead of creating or deleting a company');
    }
    if (collectionName === 'accounts') {
      throw new BadRequestException('Manage worker accounts from the Team accounts section');
    }
    if (collectionName === 'drivers') {
      throw new BadRequestException('Create drivers as workers with the Driver role');
    }
    if (collectionName === 'auditLogs') {
      throw new BadRequestException('Audit logs are read-only and must be generated by system actions');
    }
  }

  async requireCompanyWarehouseId(
    companyId: Types.ObjectId,
    warehouseIdInput: string,
  ): Promise<Types.ObjectId> {
    const warehouseId = this.validObjectId(warehouseIdInput, 'warehouseId');
    const warehouse = await this.db.collection('warehouses').findOne(
      { _id: warehouseId, companyId },
      { projection: { _id: 1 } },
    );
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    return warehouseId;
  }

  private supportsWarehouseRecords(collectionName: string): boolean {
    return new Set([
      'trucks',
      'trips',
      'expenses',
      'truckExpenses',
      'cocoaLots',
      'stockMovements',
      'materials',
      'materialMovements',
      'fuelLogs',
      'maintenance',
      'assets',
      'purchases',
      'sales',
      'purchaseOrders',
      'salesOrders',
      'supplierPayments',
      'supplierAdvances',
      'customerPayments',
      'customerAdvances',
    ]).has(collectionName);
  }

  private isTruckLinkedRecord(
    collectionName: string,
    record: Record<string, unknown>,
  ): boolean {
    return collectionName === 'fuelLogs' || collectionName === 'truckExpenses' ||
      (collectionName === 'expenses' && record.costCenterType === 'truck');
  }

  private async truckLinkedWarehouseId(
    companyId: Types.ObjectId,
    collectionName: string,
    record: Record<string, unknown>,
    existing?: Record<string, unknown>,
  ): Promise<Types.ObjectId | undefined> {
    if (!this.isTruckLinkedRecord(collectionName, record)) return undefined;
    const truckIdInput = collectionName === 'expenses' ? record.costCenterId : record.truckId;
    const truckId = this.validObjectId(String(truckIdInput ?? ''), collectionName === 'expenses' ? 'costCenterId' : 'truckId');
    const existingTruckId = collectionName === 'expenses' ? existing?.costCenterId : existing?.truckId;
    const sameTruck = existingTruckId instanceof Types.ObjectId && existingTruckId.equals(truckId);
    if (sameTruck && existing?.warehouseId instanceof Types.ObjectId) {
      return existing.warehouseId;
    }

    const truck = await this.db.collection('trucks').findOne(
      { _id: truckId, companyId, status: 'active' },
      { projection: { warehouseId: 1 } },
    );
    if (!truck || !(truck.warehouseId instanceof Types.ObjectId)) {
      throw new BadRequestException('Truck expenses must reference an active company truck with a warehouse');
    }
    return truck.warehouseId;
  }

  private async syncDriverWarehouseAssignments(
    companyId: Types.ObjectId,
    driverIds: unknown[],
    session?: ClientSession,
  ): Promise<void> {
    const uniqueDriverIds = new Map<string, Types.ObjectId>();
    for (const value of driverIds) {
      const id = value instanceof Types.ObjectId
        ? value
        : typeof value === 'string' && Types.ObjectId.isValid(value)
          ? new Types.ObjectId(value)
          : null;
      if (id) uniqueDriverIds.set(id.toString(), id);
    }

    for (const driverId of uniqueDriverIds.values()) {
      const trucks = await this.db.collection('trucks').find(
        { companyId, driverId, status: 'active' },
        { projection: { warehouseId: 1 }, ...(session ? { session } : {}) },
      ).toArray();
      const warehouseIds = [
        ...new Map(
          trucks
            .filter((truck) => truck.warehouseId instanceof Types.ObjectId)
            .map((truck) => [truck.warehouseId.toString(), truck.warehouseId]),
        ).values(),
      ];
      await this.db.collection('accounts').updateOne(
        { _id: driverId, companyId, role: 'driver' },
        { $set: { warehouseIds, updatedAt: new Date() } },
        session ? { session } : {},
      );
    }
  }

  private prepareModuleRecord(
    input: Record<string, unknown>,
    collectionName: string,
    creating: boolean,
  ) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Record must be a JSON object');
    }
    for (const key of Object.keys(input)) {
      if (RESERVED_FIELDS.has(key)) {
        throw new BadRequestException(`${key} is managed by the server`);
      }
    }
    if (creating) {
      const missing = (REQUIRED_MODULE_FIELDS[collectionName] ?? [])
        .filter((field) => input[field] === undefined || input[field] === null || input[field] === '');
      if (missing.length) {
        throw new BadRequestException(`Required record fields: ${missing.join(', ')}`);
      }
    }
    return this.normalizeRecordValues(input);
  }

  private normalizeModuleSpecificValues(
    collectionName: string,
    record: Record<string, unknown>,
    creating = false,
  ) {
    if (creating) {
      const now = new Date();
      const defaults: Record<string, Record<string, unknown>> = {
        warehouses: { status: 'active', location: '', address: '', lowStockThresholdKg: null },
        cocoaLots: { status: 'available' },
        expenseCategories: { status: 'active' },
        stockMovements: { occurredAt: now },
        trucks: { status: 'active', driverId: null, assetId: null },
        trips: {
          transportedQuantityKg: Types.Decimal128.fromString('0'),
          driverId: null,
          shipmentId: null,
          startedAt: null,
          completedAt: null,
        },
        expenses: {
          baseAmount: null,
          exchangeRate: null,
          truckId: null,
          tripId: null,
          paymentStatus: 'unpaid',
          incurredAt: now,
        },
        truckExpenses: {
          baseAmount: null,
          exchangeRate: null,
          tripId: null,
          incurredAt: now,
        },
        fuelLogs: { tripId: null, expenseId: null, occurredAt: now },
        maintenance: { expenseId: null, status: 'scheduled', occurredAt: now },
        materialMovements: { occurredAt: now },
      };
      for (const [key, value] of Object.entries(defaults[collectionName] ?? {})) {
        if (record[key] === undefined) record[key] = value;
      }
    }

    for (const [field, values] of Object.entries(ENUM_FIELDS[collectionName] ?? {})) {
      if (record[field] !== undefined && !values.includes(String(record[field]))) {
        throw new BadRequestException(`${field} must be one of: ${values.join(', ')}`);
      }
    }
    if (collectionName === 'warehouses') {
      if (record.code !== undefined) {
        if (typeof record.code !== 'string') throw new BadRequestException('Warehouse code must be text');
        record.code = record.code.trim().toUpperCase();
      }
      if (record.name !== undefined) {
        if (typeof record.name !== 'string') throw new BadRequestException('Warehouse name must be text');
        record.name = record.name.trim();
      }
      if (record.code === '' || record.name === '') {
        throw new BadRequestException('Warehouse code and name cannot be empty');
      }
    }
    if (collectionName === 'trucks') {
      if (typeof record.name === 'string') record.name = record.name.trim();
      if (typeof record.registrationNumber === 'string') {
        record.registrationNumber = record.registrationNumber.trim().toUpperCase();
      }
    }
    if (collectionName === 'cocoaLots' && typeof record.lotNumber === 'string') {
      record.lotNumber = record.lotNumber.trim();
    }
    if (
      ['expenses', 'truckExpenses', 'fuelLogs'].includes(collectionName) &&
      typeof record.currencyCode === 'string'
    ) {
      record.currencyCode = record.currencyCode.trim().toUpperCase();
    }
    if (
      ['expenses', 'truckExpenses', 'fuelLogs'].includes(collectionName) &&
      record.currencyCode !== undefined &&
      (typeof record.currencyCode !== 'string' || !/^[A-Z]{3}$/.test(record.currencyCode))
    ) {
      throw new BadRequestException('Currency code must be a three-letter ISO code');
    }
    if (['expenses', 'truckExpenses'].includes(collectionName) && typeof record.category === 'string') {
      record.category = record.category.trim().toLowerCase();
    }
  }

  private throwDuplicateConflict(error: unknown): void {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    ) {
      throw new ConflictException('A company record with these unique values already exists');
    }
  }

  private normalizeRecordValues(
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key.startsWith('$') || key.includes('.') || SENSITIVE_FIELD.test(key)) {
        throw new BadRequestException(`The field "${key}" is not allowed`);
      }
      if (
        value instanceof Types.ObjectId ||
        value instanceof Types.Decimal128 ||
        value instanceof Date
      ) {
        normalized[key] = value;
        continue;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        normalized[key] = this.normalizeRecordValues(value as Record<string, unknown>);
        continue;
      }
      if (Array.isArray(value)) {
        normalized[key] = value.map((item) =>
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          !(item instanceof Types.ObjectId) &&
          !(item instanceof Types.Decimal128) &&
          !(item instanceof Date)
            ? this.normalizeRecordValues(item as Record<string, unknown>)
            : item,
        );
        continue;
      }
      normalized[key] = value;
    }
    return normalized;
  }

  private async normalizeModuleRecord(
    input: Record<string, unknown>,
    companyId: Types.ObjectId,
  ): Promise<Record<string, unknown>> {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      normalized[key] = await this.normalizeModuleValue(key, value, companyId, input);
    }
    return normalized;
  }

  private async normalizeModuleValue(
    key: string,
    value: unknown,
    companyId: Types.ObjectId,
    context: Record<string, unknown>,
  ): Promise<unknown> {
    if (Array.isArray(value)) {
      return Promise.all(value.map((item) => this.normalizeModuleValue(key, item, companyId, context)));
    }
    if (value instanceof Types.ObjectId || value instanceof Types.Decimal128) {
      return value;
    }
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return this.normalizeModuleRecord(value as Record<string, unknown>, companyId);
    }

    const singularIdKey = key.endsWith('Ids') ? `${key.slice(0, -1)}` : key;
    const targetCollection = singularIdKey === 'costCenterId'
      ? { warehouse: 'warehouses', truck: 'trucks', trip: 'trips' }[
        String(context.costCenterType)
      ]
      : REFERENCE_COLLECTIONS[singularIdKey];
    if (
      typeof value === 'string' &&
      (singularIdKey.endsWith('Id') || key.endsWith('Ids')) &&
      value
    ) {
      const referenceId = this.validObjectId(value, key);
      if (targetCollection) {
        const referenceFilter: MongoDocument = {
          _id: referenceId,
          companyId,
        };
        if (singularIdKey === 'driverId' && targetCollection === 'accounts') {
          referenceFilter.role = 'driver';
          referenceFilter.status = 'active';
        }
        const referenced = await this.db.collection(targetCollection).findOne(
          referenceFilter,
          { projection: { _id: 1 } },
        );
        if (!referenced) {
          throw new BadRequestException(
            singularIdKey === 'driverId'
              ? 'driverId must reference an active driver worker in your company'
              : `${key} must reference a record in your company`,
          );
        }
      }
      return referenceId;
    }
    if (DECIMAL_FIELDS.has(key) && value !== null && value !== '') {
      const decimalValue = String(value);
      if (!/^-?\d+(?:\.\d+)?$/.test(decimalValue)) {
        throw new BadRequestException(`${key} must be a valid decimal number`);
      }
      try {
        return Types.Decimal128.fromString(decimalValue);
      } catch {
        throw new BadRequestException(`${key} must be a valid decimal number`);
      }
    }
    if (/^(date|.*(?:At|Date))$/i.test(key) && typeof value === 'string' && value) {
      return this.parseDate(value, key);
    }
    return value;
  }

  private async updateCompanyProfile(
    companyId: Types.ObjectId,
    recordIdInput: string,
    input: Record<string, unknown>,
  ) {
    const recordId = this.validObjectId(recordIdInput, 'recordId');
    if (!recordId.equals(companyId)) throw new NotFoundException('Company record not found');
    const allowed = new Set(['name', 'baseCurrencyCode', 'currencyCode']);
    const keys = Object.keys(input);
    if (keys.length === 0 || keys.some((key) => !allowed.has(key))) {
      throw new BadRequestException('Only company name and currency can be updated here');
    }
    const update: Record<string, string> = {};
    if ('name' in input) {
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120) {
        throw new BadRequestException('Company name must be between 1 and 120 characters');
      }
      update.name = input.name.trim();
    }
    const requestedCurrency = input.baseCurrencyCode ?? input.currencyCode;
    if (requestedCurrency !== undefined) {
      if (typeof requestedCurrency !== 'string' || !/^[A-Za-z]{3}$/.test(requestedCurrency)) {
        throw new BadRequestException('Base currency must be a three-letter ISO code');
      }
      update.baseCurrencyCode = requestedCurrency.toUpperCase();
    }
    await this.db.collection('companies').updateOne(
      { _id: companyId },
      { $set: { ...update, updatedAt: new Date() } },
    );
    const company = await this.db.collection('companies').findOne({ _id: companyId });
    if (!company) throw new NotFoundException('Company not found');
    return this.sanitizeModuleRecord(company);
  }

  private sanitizeModuleRecord(value: unknown): unknown {
    if (value instanceof Types.ObjectId) return value.toString();
    if (value instanceof Types.Decimal128) return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => this.sanitizeModuleRecord(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !SENSITIVE_FIELD.test(key))
          .map(([key, item]) => [key, this.sanitizeModuleRecord(item)]),
      );
    }
    return value;
  }

  private parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid date`);
    }
    return date;
  }

  private expenseDocumentFilter(filters: ExpenseFilters): MongoDocument {
    const match: MongoDocument = {};
    if (filters.category) match.category = filters.category;
    if (filters.paymentStatus) match.paymentStatus = filters.paymentStatus;
    if (filters.truckId) match.truckId = this.validObjectId(filters.truckId, 'truckId');
    if (filters.tripId) match.tripId = this.validObjectId(filters.tripId, 'tripId');
    const incurredAt: MongoDocument = {};
    if (filters.from) incurredAt.$gte = this.parseDate(filters.from, 'from');
    if (filters.to) {
      const end = this.parseDate(filters.to, 'to');
      end.setUTCHours(23, 59, 59, 999);
      incurredAt.$lte = end;
    }
    if (Object.keys(incurredAt).length) match.incurredAt = incurredAt;
    return match;
  }

  private async groupCountsByWarehouse(
    companyId: Types.ObjectId,
    collectionName: string,
    filter: MongoDocument,
  ) {
    const rows = await this.db.collection(collectionName).aggregate<{
      _id: Types.ObjectId;
      count: number;
    }>([
      { $match: { companyId, warehouseId: { $type: 'objectId' }, ...filter } },
      { $group: { _id: '$warehouseId', count: { $sum: 1 } } },
    ]).toArray();
    return rows.map((row) => ({ id: row._id.toString(), count: row.count }));
  }

  private expensePipeline(match: MongoDocument, includeFuelLogs: boolean): MongoDocument[] {
    const pipeline: MongoDocument[] = [{ $match: match }];
    if (includeFuelLogs && !('paymentStatus' in match)) {
      pipeline.push({
        $unionWith: {
          coll: 'truckExpenses',
          pipeline: [
            { $match: match },
            {
              $addFields: {
                costCenterType: 'truck',
                costCenterId: '$truckId',
                paymentStatus: { $ifNull: ['$paymentStatus', 'unpaid'] },
              },
            },
          ],
        },
      });
    }
    const fuelLogMatch = includeFuelLogs ? this.fuelLogMatch(match) : null;
    if (!fuelLogMatch) return pipeline;
    pipeline.push({
      $unionWith: {
        coll: 'fuelLogs',
        pipeline: [
          { $match: { ...fuelLogMatch, expenseId: null } },
          {
            $addFields: {
              category: 'fuel',
              incurredAt: '$occurredAt',
              amount: {
                $multiply: [decimal('$quantityLiters'), decimal('$unitPrice')],
              },
            },
          },
        ],
      },
    });
    return pipeline;
  }

  private fuelLogMatch(expenseMatch: MongoDocument): MongoDocument | null {
    const match = { ...expenseMatch };
    const category = match.category;
    if (
      typeof category === 'string' && category !== 'fuel' ||
      typeof category === 'object' && category !== null &&
        '$in' in category && !((category.$in as unknown[]) ?? []).includes('fuel')
    ) {
      return null;
    }
    if ('paymentStatus' in match) return null;
    delete match.category;
    if ('incurredAt' in match) {
      match.occurredAt = match.incurredAt;
      delete match.incurredAt;
    }
    return match;
  }

  private async expensesByWarehouse(companyId: Types.ObjectId, currencyCode: string) {
    const rows = await this.db.collection('expenses').aggregate<{
      _id: Types.ObjectId;
      amount: Types.Decimal128;
    }>([
      ...this.expensePipeline(
        { companyId, warehouseId: { $type: 'objectId' } },
        true,
      ),
      {
        $group: {
          _id: '$warehouseId',
          amount: { $sum: this.companyExpenseAmount(currencyCode) },
        },
      },
    ]).toArray();
    return rows.map((row) => ({
      id: row._id.toString(),
      amount: Number(row.amount?.toString() ?? 0),
    }));
  }

  private async assetBookValue(companyId: Types.ObjectId): Promise<number> {
    const [result] = await this.db.collection('assets').aggregate<{
      total: Types.Decimal128;
    }>([
      { $match: { companyId, status: { $nin: ['sold', 'disposed', 'deleted'] } } },
      {
        $addFields: {
          _cost: decimal('$acquisitionCost'),
          _depreciation: decimal('$accumulatedDepreciation'),
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $max: [
                ZERO_DECIMAL,
                { $subtract: ['$_cost', '$_depreciation'] },
              ],
            },
          },
        },
      },
    ]).toArray();
    return result?.total ? Number(result.total.toString()) : 0;
  }

  private async monthlyExpenseTrend(
    companyId: Types.ObjectId,
    currencyCode: string,
    includeFuelLogs = false,
  ) {
    const from = new Date();
    from.setUTCMonth(from.getUTCMonth() - 11, 1);
    from.setUTCHours(0, 0, 0, 0);
    return this.db.collection('expenses').aggregate<{
      _id: string;
      total: Types.Decimal128;
    }>([
      ...this.expensePipeline(
        { companyId, incurredAt: { $gte: from, $lte: new Date() } },
        includeFuelLogs,
      ),
      {
        $group: {
          _id: { $dateToString: { date: '$incurredAt', format: '%Y-%m' } },
          total: { $sum: this.companyExpenseAmount(currencyCode) },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray();
  }

  private async expenseGroupsByCategories(
    companyId: Types.ObjectId,
    categories: string[],
    currencyCode: string,
    includeFuelLogs = false,
  ) {
    const rows = await this.db.collection('expenses').aggregate<{
      _id: string;
      total: Types.Decimal128;
    }>([
      ...this.expensePipeline({
          companyId,
          category: { $in: categories },
          incurredAt: { $gte: this.utcMonthStart(), $lte: new Date() },
        }, includeFuelLogs),
      { $group: { _id: '$category', total: { $sum: this.companyExpenseAmount(currencyCode) } } },
    ]).toArray();
    const byCategory = new Map(rows.map((row) => [row._id, Number(row.total?.toString() ?? 0)]));
    return {
      fuel: byCategory.get('fuel') ?? 0,
      maintenance: byCategory.get('maintenance') ?? 0,
    };
  }

  private async operationalVsTransportation(
    companyId: Types.ObjectId,
    currencyCode: string,
    includeFuelLogs = false,
  ) {
    const rows = await this.db.collection('expenses').aggregate<{
      _id: 'operational' | 'transportation';
      total: Types.Decimal128;
    }>([
      ...this.expensePipeline({ companyId }, includeFuelLogs),
      {
        $group: {
          _id: {
            $cond: [
              {
                $in: [
                  { $toLower: '$category' },
                  ['transport', 'transportation', 'freight', 'haulage', 'shipping'],
                ],
              },
              'transportation',
              'operational',
            ],
          },
          total: { $sum: this.companyExpenseAmount(currencyCode) },
        },
      },
    ]).toArray();
    const totals = new Map(rows.map((row) => [row._id, Number(row.total?.toString() ?? 0)]));
    return {
      operational: totals.get('operational') ?? 0,
      transportation: totals.get('transportation') ?? 0,
    };
  }

  private async companyCurrency(companyId: Types.ObjectId): Promise<string> {
    const company = await this.db.collection('companies').findOne(
      { _id: companyId },
      { projection: { baseCurrencyCode: 1 } },
    );
    return typeof company?.baseCurrencyCode === 'string'
      ? company.baseCurrencyCode.toUpperCase()
      : 'USD';
  }

  private async addBaseCurrencyAmount(
    companyId: Types.ObjectId,
    collectionName: string,
    record: Record<string, unknown>,
  ): Promise<void> {
    if (!['expenses', 'truckExpenses', 'fuelLogs'].includes(collectionName)) return;
    const currencyCode = String(record.currencyCode ?? '').toUpperCase();
    const baseCurrencyCode = await this.companyCurrency(companyId);
    if (!/^[A-Z]{3}$/.test(currencyCode)) {
      throw new BadRequestException('Currency code must be a three-letter ISO code');
    }

    const amounts = collectionName === 'fuelLogs'
      ? [String(record.quantityLiters), String(record.unitPrice)]
      : [String(record.amount)];
    if (amounts.some((amount) => amount === 'undefined' || amount === 'null')) {
      return;
    }
    const exchangeRate = await this.currencyConversionRate(currencyCode, baseCurrencyCode);
    const baseAmount = decimalProductToCents([...amounts, exchangeRate.toFixed(10)]);
    record.baseAmount = Types.Decimal128.fromString(baseAmount);
    record.exchangeRate = Types.Decimal128.fromString(exchangeRate.toFixed(10));
  }

  private async currencyConversionRate(fromCurrency: string, toCurrency: string): Promise<number> {
    if (fromCurrency === toCurrency) return 1;
    return this.historicalCurrencyConversionRate(
      fromCurrency,
      toCurrency,
      new Date().toISOString().slice(0, 10),
    );
  }

  private async historicalCurrencyConversionRate(
    fromCurrency: string,
    toCurrency: string,
    date: string,
  ): Promise<number> {
    if (fromCurrency === toCurrency) return 1;
    const query = new URLSearchParams({
      base: fromCurrency,
      symbols: toCurrency,
    });
    try {
      const response = await fetch(
        `${HISTORICAL_CURRENCY_RATES_URL}/${encodeURIComponent(date)}?${query.toString()}`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (response.ok) {
        const data = await response.json() as { rates?: Record<string, number> };
        const historicalRate = data.rates?.[toCurrency];
        if (
          typeof historicalRate === 'number' &&
          Number.isFinite(historicalRate) &&
          historicalRate > 0
        ) {
          return historicalRate;
        }
      }
    } catch {
      // Fall back to the latest published rate when historical data is unavailable.
    }
    return this.latestCurrencyConversionRate(fromCurrency, toCurrency);
  }

  private async latestCurrencyConversionRate(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<number> {
    try {
      const response = await fetch(LATEST_CURRENCY_RATES_URL, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        throw new Error(`Currency service returned HTTP ${response.status}`);
      }
      const data = await response.json() as {
        result?: string;
        rates?: Record<string, number>;
      };
      const rates = data.rates;
      const fromRate = rates?.[fromCurrency];
      const toRate = rates?.[toCurrency];
      if (
        data.result !== 'success' ||
        typeof fromRate !== 'number' || !Number.isFinite(fromRate) || fromRate <= 0 ||
        typeof toRate !== 'number' || !Number.isFinite(toRate) || toRate <= 0
      ) {
        throw new Error(`No current conversion rate for ${fromCurrency} to ${toCurrency}`);
      }
      return toRate / fromRate;
    } catch {
      throw new ServiceUnavailableException(
        `Exchange rates for ${fromCurrency} to ${toCurrency} are temporarily unavailable. The record will be retried automatically.`,
      );
    }
  }

  private companyExpenseAmount(currencyCode: string): Record<string, unknown> {
    const baseCurrencyCode = currencyCode.toUpperCase();
    return {
      $cond: [
        { $eq: [{ $toUpper: '$currencyCode' }, baseCurrencyCode] },
        decimal('$amount'),
        {
          $convert: {
            input: '$baseAmount',
            to: 'decimal',
            onError: ZERO_DECIMAL,
            onNull: ZERO_DECIMAL,
          },
        },
      ],
    };
  }

  private async unconvertedExpenseCount(
    companyId: Types.ObjectId,
    currencyCode: string,
    filters: ExpenseFilters & { warehouseId?: Types.ObjectId },
    includeFuelLogs = false,
  ): Promise<number> {
    const expenseFilter = {
      companyId,
      ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
      $expr: {
        $ne: [
          { $toUpper: { $ifNull: ['$currencyCode', ''] } },
          currencyCode.toUpperCase(),
        ],
      },
      $or: [{ baseAmount: null }, { baseAmount: { $exists: false } }],
      ...this.expenseDocumentFilter(filters),
    };
    const expenseCount = this.db.collection('expenses').countDocuments(expenseFilter);
    if (!includeFuelLogs) return expenseCount;
    const fuelLogMatch = this.fuelLogMatch({
      companyId,
      ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
      ...this.expenseDocumentFilter(filters),
    });
    if (!fuelLogMatch) return expenseCount;
    const [expenses, truckExpenses, fuelLogs] = await Promise.all([
      expenseCount,
      'paymentStatus' in this.expenseDocumentFilter(filters)
        ? Promise.resolve(0)
        : this.db.collection('truckExpenses').countDocuments(expenseFilter),
      this.db.collection('fuelLogs').countDocuments({
        ...fuelLogMatch,
        expenseId: null,
        $expr: {
          $ne: [
            { $toUpper: { $ifNull: ['$currencyCode', ''] } },
            currencyCode.toUpperCase(),
          ],
        },
      }),
    ]);
    return expenses + truckExpenses + fuelLogs;
  }

  private utcMonthStart() {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }
}
