import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { InjectConnection } from '@nestjs/mongoose';
import { verifyToken } from '@clerk/backend';
import type { Connection } from 'mongoose';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator.js';

type AuthenticatedRequest = Request & {
  auth: { clerkUserId: string };
};

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;
    if (!token) throw new UnauthorizedException('Bearer token is required');

    const secretKey = this.config.get<string>('CLERK_SECRET_KEY');
    if (!secretKey) {
      throw new UnauthorizedException('Authentication is not configured');
    }

    try {
      const claims = await verifyToken(token, { secretKey });
      if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
        throw new UnauthorizedException('Token has no user identity');
      }
      if (this.connection.readyState !== 1) {
        throw new ServiceUnavailableException(
          'Database connection is unavailable. Check MongoDB Atlas Network Access and try again.',
        );
      }
      request.auth = { clerkUserId: claims.sub };
      return true;
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired Clerk token');
    }
  }
}

export function getClerkUserId(
  request: Request & { auth?: { clerkUserId: string } },
): string {
  if (!request.auth?.clerkUserId) {
    throw new UnauthorizedException('Authenticated user context is missing');
  }
  return request.auth.clerkUserId;
}
