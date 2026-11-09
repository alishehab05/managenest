import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let healthController: HealthController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{
        provide: getConnectionToken(),
        useValue: { readyState: 1 },
      }],
    }).compile();

    healthController = app.get<HealthController>(HealthController);
  });

  describe('health', () => {
    it('returns the healthy service status', () => {
      expect(healthController.getHealth()).toEqual({
        status: 'ok',
        service: 'factory-erp-api',
      });
    });

    it('reports the database as unavailable when MongoDB is disconnected', () => {
      healthController = new HealthController({ readyState: 0 } as unknown as Connection);
      expect(() => healthController.getHealth()).toThrow(
        'Database connection is unavailable. Check MongoDB Atlas network access and try again.',
      );
    });
  });
});
