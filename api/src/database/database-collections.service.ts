import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection, mongo } from 'mongoose';
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
