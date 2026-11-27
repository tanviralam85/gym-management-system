import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export function connectDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL before running authentication.');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
