import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import type { MongooseError } from 'mongoose';
import { AuthModule } from './auth/auth.module.js';
import { ClerkAuthGuard } from './auth/clerk-auth.guard.js';
import { CompaniesModule } from './companies/companies.module.js';
import { HealthController } from './health.controller.js';
import { WarehousesModule } from './warehouses/warehouses.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AdminModule } from './admin/admin.module.js';
import { WorkersModule } from './workers/workers.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { TasksModule } from './tasks/tasks.module.js';

const mongoLogger = new Logger('MongoDB');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        dbName: config.get<string>('MONGODB_DB', 'COCOA_ERP_DB'),
        lazyConnection: true,
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 8000,
        connectionFactory: (connection) => {
          connection.on('connected', () => {
            mongoLogger.log('MongoDB connection established.');
          });
          connection.on('disconnected', () => {
            mongoLogger.warn('MongoDB connection lost.');
          });
          connection.on('error', (error: Error) => {
            mongoLogger.error(`MongoDB connection error: ${error.name}`);
          });
          return connection;
        },
        connectionErrorFactory: (error: MongooseError) => {
          const errorWithServers = error as MongooseError & {
            reason?: { servers?: Map<string, { error?: Error }> };
          };
          const serverErrors = [...(errorWithServers.reason?.servers ?? [])]
            .flatMap(([server, state]) =>
              state.error
                ? [`${server}: ${state.error.name}: ${state.error.message}`]
                : [],
            );
          const detail = serverErrors.length
            ? serverErrors.join('; ')
            : error.message;
          const safeDetail = detail.replace(
            /mongodb(?:\+srv)?:\/\/[^/\s@]+@/gi,
            'mongodb+srv://[credentials-redacted]@',
          );
          mongoLogger.error(`Connection failed (${error.name}): ${safeDetail}`);
          return error;
        },
      }),
    }),
    AuthModule,
    CompaniesModule,
    WarehousesModule,
    DatabaseModule,
    AdminModule,
    WorkersModule,
    DashboardModule,
    TasksModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ClerkAuthGuard }],
})
export class AppModule {}
