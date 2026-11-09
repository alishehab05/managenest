import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseUnavailableFilter } from './database-unavailable.filter.js';

describe('DatabaseUnavailableFilter', () => {
  it('returns a clear service-unavailable response for database outages', () => {
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    const filter = new DatabaseUnavailableFilter();

    filter.catch(new Error('database connection timed out'), host);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 503,
      message: 'Database connection is unavailable. Check MongoDB Atlas network access and try again.',
    });
  });
});
