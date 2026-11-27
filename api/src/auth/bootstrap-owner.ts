import { randomBytes } from 'node:crypto';
import { normalizeUsername, validUsername, hashPassword } from './credentials.js';
import { connectDatabase } from './database.js';

const username = normalizeUsername(process.argv[2]);
if (!validUsername(username)) throw new Error('Provide a username of 3–64 letters, numbers, dots, underscores or hyphens.');

const db = connectDatabase();
try {
  const temporaryPassword = randomBytes(18).toString('base64url');
  const passwordHash = await hashPassword(temporaryPassword);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(240601)`;
    if (await tx.account.findFirst({ where: { role: 'OWNER' } })) {
      throw new Error('An Owner already exists for this installation.');
    }
    await tx.account.create({ data: { username, role: 'OWNER', passwordHash } });
  });
  console.log('Owner created. Temporary password (shown once):', temporaryPassword);
} finally {
  await db.$disconnect();
}
