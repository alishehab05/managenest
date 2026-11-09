import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/backend';
import { isClerkAPIResponseError } from '@clerk/backend/errors';
import { randomBytes } from 'node:crypto';

@Injectable()
export class ClerkUsersService {
  private readonly client;

  constructor(config: ConfigService) {
    this.client = createClerkClient({
      secretKey: config.getOrThrow<string>('CLERK_SECRET_KEY'),
    });
  }

  createManagedUser(name: string, username: string, phoneNumber?: string) {
    const [firstName, ...lastName] = name.trim().split(/\s+/);
    const initialPassword = `${randomBytes(24).toString('base64url')}A1!`;
    return this.client.users
      .createUser({
        username: username.trim().toLowerCase(),
        ...(phoneNumber
          ? {
              phoneNumber: [phoneNumber],
              phoneNumberIdentificationStatus: ['reserved' as const],
            }
          : {}),
        firstName,
        lastName: lastName.join(' '),
        password: initialPassword,
      })
      .then((user) => ({ user, initialPassword }))
      .catch((error: unknown) => {
        if (isClerkAPIResponseError(error) && error.status === 422) {
          throw new BadRequestException(
            error.errors
              .map((item) => item.longMessage ?? item.message)
              .join(', '),
          );
        }
        throw error;
      });
  }

  updateManagedUser(clerkUserId: string, name?: string, username?: string) {
    const updates: { firstName?: string; lastName?: string; username?: string } = {};
    if (name !== undefined) {
      const [firstName, ...lastName] = name.trim().split(/\s+/);
      updates.firstName = firstName;
      updates.lastName = lastName.join(' ');
    }
    if (username !== undefined) updates.username = username.trim().toLowerCase();
    return this.client.users.updateUser(clerkUserId, updates);
  }

  async hasVerifiedEmail(clerkUserId: string, email: string): Promise<boolean> {
    const user = await this.client.users.getUser(clerkUserId);
    return user.emailAddresses.some(
      (address) =>
        address.emailAddress.toLowerCase() === email.toLowerCase() &&
        address.verification?.status === 'verified',
    );
  }

  async ensureUsername(clerkUserId: string): Promise<string> {
    const user = await this.client.users.getUser(clerkUserId);
    if (user.username) return user.username.toLowerCase();
    const username = `legacy_${clerkUserId.slice(-12).toLowerCase()}`;
    await this.client.users.updateUser(clerkUserId, { username });
    return username;
  }

  ban(clerkUserId: string) {
    return this.client.users.banUser(clerkUserId);
  }

  unban(clerkUserId: string) {
    return this.client.users.unbanUser(clerkUserId);
  }

  deleteManagedUser(clerkUserId: string) {
    return this.client.users.deleteUser(clerkUserId);
  }
}
