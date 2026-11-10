import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection, mongo } from 'mongoose';
import { Types } from 'mongoose';
import { ClerkUsersService } from '../auth/clerk-users.service.js';
import { ERP_COLLECTIONS } from './erp-collections.js';

@Injectable()
export class DatabaseCollectionsService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseCollectionsService.name);
  private initializationStarted = false;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly clerk: ClerkUsersService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.connection.readyState !== 1) {
      this.logger.warn('MongoDB is unavailable; ERP collection initialization will wait for reconnection.');
      this.connection.on('connected', () => this.initializeWhenConnected());
      return;
    }
    this.initializationStarted = true;
    await this.initializeCollections();
  }

  private initializeWhenConnected() {
    if (this.initializationStarted) return;
    this.initializationStarted = true;
    void this.initializeCollections().catch((cause: unknown) => {
      this.initializationStarted = false;
      const errorName = cause instanceof Error ? cause.name : 'UnknownError';
      this.logger.error(`ERP collection initialization failed after MongoDB reconnected (${errorName}).`);
    });
  }

  private async initializeCollections(): Promise<void> {
    const database = this.connection.db;
    if (!database) {
      throw new Error('MongoDB connection is not ready to initialize ERP collections');
    }

    const existing = new Set(
      (
        await database
          .listCollections({}, { nameOnly: true })
          .toArray()
      ).map(({ name }) => name),
    );
    const missing = ERP_COLLECTIONS.filter((name) => !existing.has(name));
    await Promise.all(missing.map((name) => database.createCollection(name)));
    await this.migrateLegacyWarehouseCompanyIds(database);
    await this.migrateTruckExpenseWarehouseIds(database);
    await this.migrateLegacyWorkerSpecialties(database);
    await this.syncDriverWarehouseAssignments(database);
    await this.backfillLegacyUsernames(database.collection('users'));
    await this.backfillLegacyUsernames(database.collection('accounts'));

    this.logger.log(
      `ERP collection setup complete: ${ERP_COLLECTIONS.length - missing.length} already existed, ${missing.length} created.`,
    );
  }

  private async migrateLegacyWarehouseCompanyIds(database: mongo.Db): Promise<void> {
    const companyIds = (await database
      .collection('companies')
      .find({}, { projection: { _id: 1 } })
      .toArray())
      .map((company) => company._id.toString());
    if (companyIds.length === 0) return;

    const result = await database.collection('warehouses').updateMany(
      { companyId: { $type: 'string', $in: companyIds } },
      [{ $set: { companyId: { $toObjectId: '$companyId' } } }],
    );
    if (result.modifiedCount > 0) {
      this.logger.log(
        `Normalized company ownership on ${result.modifiedCount} legacy warehouse record(s).`,
      );
    }
  }

  private async migrateLegacyWorkerSpecialties(database: mongo.Db): Promise<void> {
    const result = await database.collection('accounts').updateMany(
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
    if (result.modifiedCount > 0) {
      this.logger.log(
        `Migrated the legacy specialties field on ${result.modifiedCount} worker account(s).`,
      );
    }
  }

  private async migrateTruckExpenseWarehouseIds(database: mongo.Db): Promise<void> {
    let migratedCount = 0;
    for (const [collectionName, truckField] of [
      ['truckExpenses', 'truckId'],
      ['fuelLogs', 'truckId'],
      ['expenses', 'costCenterId'],
    ]) {
      const filter: Record<string, unknown> = {
        [truckField]: { $type: 'objectId' },
        $or: [
          { warehouseId: { $exists: false } },
          { warehouseId: { $not: { $type: 'objectId' } } },
        ],
        ...(collectionName === 'expenses' ? { costCenterType: 'truck' } : {}),
      };
      const records = await database.collection(collectionName)
        .find(filter, { projection: { companyId: 1, [truckField]: 1 } })
        .toArray();
      for (const record of records) {
        if (!(record.companyId instanceof Types.ObjectId)) continue;
        const truck = await database.collection('trucks').findOne(
          {
            _id: record[truckField],
            companyId: record.companyId,
            warehouseId: { $type: 'objectId' },
          },
          { projection: { warehouseId: 1 } },
        );
        if (!(truck?.warehouseId instanceof Types.ObjectId)) continue;
        const result = await database.collection(collectionName).updateOne(
          { _id: record._id, companyId: record.companyId },
          { $set: { warehouseId: truck.warehouseId, updatedAt: new Date() } },
        );
        migratedCount += result.modifiedCount;
      }
    }
    if (migratedCount > 0) {
      this.logger.log(`Repaired warehouse links on ${migratedCount} truck expense record(s).`);
    }
  }

  private async syncDriverWarehouseAssignments(database: mongo.Db): Promise<void> {
    const trucks = await database.collection('trucks')
      .find(
        { status: 'active', driverId: { $type: 'objectId' } },
        { projection: { companyId: 1, driverId: 1, warehouseId: 1 } },
      )
      .toArray();
    const warehousesByDriver = new Map<string, {
      companyId: Types.ObjectId;
      driverId: Types.ObjectId;
      warehouseIds: Map<string, Types.ObjectId>;
    }>();
    for (const truck of trucks) {
      if (
        !(truck.companyId instanceof Types.ObjectId) ||
        !(truck.driverId instanceof Types.ObjectId) ||
        !(truck.warehouseId instanceof Types.ObjectId)
      ) continue;
      const key = `${truck.companyId.toString()}:${truck.driverId.toString()}`;
      const assignment = warehousesByDriver.get(key) ?? {
        companyId: truck.companyId,
        driverId: truck.driverId,
        warehouseIds: new Map<string, Types.ObjectId>(),
      };
      assignment.warehouseIds.set(truck.warehouseId.toString(), truck.warehouseId);
      warehousesByDriver.set(key, assignment);
    }

    await database.collection('accounts').updateMany(
      { role: 'driver' },
      { $set: { warehouseIds: [] } },
    );
    for (const { companyId, driverId, warehouseIds } of warehousesByDriver.values()) {
      await database.collection('accounts').updateOne(
        { _id: driverId, companyId, role: 'driver' },
        { $set: { warehouseIds: [...warehouseIds.values()] } },
      );
    }
    if (warehousesByDriver.size > 0) {
      this.logger.log(`Synchronized warehouse access for ${warehousesByDriver.size} assigned driver(s).`);
    }
  }

  private async backfillLegacyUsernames(
    collection: mongo.Collection,
  ): Promise<void> {
    const legacyUsers = await collection
      .find({
        clerkUserId: { $type: 'string' },
        $or: [{ username: { $exists: false } }, { username: null }, { username: '' }],
      })
      .toArray();
    for (const user of legacyUsers) {
      const username = await this.clerk.ensureUsername(user.clerkUserId);
      await collection.updateOne(
        { _id: user._id, clerkUserId: user.clerkUserId },
        { $set: { username, updatedAt: new Date() } },
      );
    }
    if (legacyUsers.length > 0) {
      this.logger.log(`Added Clerk usernames to ${legacyUsers.length} existing accounts.`);
    }
  }
}
