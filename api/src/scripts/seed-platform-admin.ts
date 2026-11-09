import { createClerkClient } from '@clerk/backend';
import mongoose, { Types } from 'mongoose';

async function seedPlatformAdmin() {
  const mongoUri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DB || 'COCOA_ERP_DB';
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  const username = process.env.PLATFORM_ADMIN_USERNAME?.trim().toLowerCase();
  const name = process.env.PLATFORM_ADMIN_NAME?.trim();
  const initialPassword = process.env.PLATFORM_ADMIN_INITIAL_PASSWORD;
  if (
    !mongoUri ||
    !clerkSecretKey ||
    !username ||
    !name ||
    !initialPassword
  ) {
    throw new Error(
      'Set PLATFORM_ADMIN_USERNAME, PLATFORM_ADMIN_NAME, and PLATFORM_ADMIN_INITIAL_PASSWORD in api/.admin-bootstrap.env.',
    );
  }
  if (initialPassword.length < 15) {
    throw new Error('PLATFORM_ADMIN_INITIAL_PASSWORD must be at least 15 characters.');
  }
  if (!/^[a-z0-9_-]{4,64}$/.test(username)) {
    throw new Error('PLATFORM_ADMIN_USERNAME must be 4-64 letters, numbers, underscores, or hyphens.');
  }

  const clerk = createClerkClient({ secretKey: clerkSecretKey });
  await mongoose.connect(mongoUri, { dbName: databaseName });
  let createdClerkUserId: string | undefined;
  try {
    const users = mongoose.connection.db!.collection('users');
    const existing = await users.findOne({ username });
    if (existing) {
      if (existing.kind !== 'platform_admin') {
        throw new Error('That username is already assigned to a non-platform-admin user.');
      }
      console.log('Platform admin record already exists; no changes made.');
      return;
    }

    const clerkMatches = await clerk.users.getUserList({
      username: [username],
      limit: 10,
    });
    let clerkUser = clerkMatches.data.find(
      (candidate) => candidate.username?.toLowerCase() === username,
    );
    if (!clerkUser) {
      const [firstName, ...lastName] = name.split(/\s+/);
      clerkUser = await clerk.users.createUser({
        username,
        firstName,
        lastName: lastName.join(' '),
        password: initialPassword,
      });
      createdClerkUserId = clerkUser.id;
    }
    if (clerkUser.banned) {
      throw new Error('The Clerk user is banned. Unban it before assigning admin access.');
    }

    const conflictingRecord = await users.findOne({ clerkUserId: clerkUser.id });
    if (conflictingRecord) {
      throw new Error('This Clerk account is already linked to a different users-table record.');
    }

    await users.insertOne({
      _id: new Types.ObjectId(),
      clerkUserId: clerkUser.id,
      username,
      email: null,
      name,
      kind: 'platform_admin',
      companyId: null,
      status: 'active',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`Platform admin @${username} added to users collection.`);
    console.log('The initial password is stored in api/.admin-bootstrap.env.');
  } catch (error) {
    if (createdClerkUserId) {
      await clerk.users.deleteUser(createdClerkUserId);
    }
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

seedPlatformAdmin().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Platform admin setup failed.');
  process.exitCode = 1;
});
