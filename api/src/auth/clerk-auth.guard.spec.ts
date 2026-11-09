import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { Connection } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/backend', () => ({ verifyToken: vi.fn() }));

import { verifyToken } from '@clerk/backend';
import type { Request } from 'express';
import { ClerkAuthGuard } from './clerk-auth.guard.js';

describe('ClerkAuthGuard', () => {
  const request = {
    headers: { authorization: 'Bearer test-token' },
  } as unknown as Request;
  const executionContext = {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  };
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(false),
  } as unknown as Reflector;
  const config = {
    get: vi.fn().mockReturnValue('test-secret'),
  } as unknown as ConfigService;
  const verifyTokenMock = vi.mocked(verifyToken);

  beforeEach(() => {
    verifyTokenMock.mockReset();
    verifyTokenMock.mockResolvedValue({ sub: 'clerk-user-id' } as never);
  });

  it('returns a clear service-unavailable error when MongoDB is disconnected', async () => {
    const guard = new ClerkAuthGuard(
      reflector,
      config,
      { readyState: 0 } as unknown as Connection,
    );

    await expect(guard.canActivate(executionContext as never))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('allows authenticated requests when MongoDB is connected', async () => {
    const guard = new ClerkAuthGuard(
      reflector,
      config,
      { readyState: 1 } as unknown as Connection,
    );

    await expect(guard.canActivate(executionContext as never)).resolves.toBe(true);
  });
});
