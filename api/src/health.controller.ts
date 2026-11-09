import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Public } from './auth/public.decorator.js';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Public()
  @Get()
  getHealth() {
    if (this.connection.readyState !== 1) {
      throw new ServiceUnavailableException(
        'Database connection is unavailable. Check MongoDB Atlas network access and try again.',
      );
    }
    return { status: 'ok', service: 'factory-erp-api' };
  }
}
