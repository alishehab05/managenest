import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseCollectionsService } from './database-collections.service.js';

@Module({
  imports: [AuthModule],
  providers: [DatabaseCollectionsService],
})
export class DatabaseModule {}
