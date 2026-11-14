import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

/** One shared client per process. `max` bounds the pg connection pool. */
export function createPrisma(databaseUrl: string, poolMax: number, connectTimeoutMs = 15_000): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      max: poolMax,
      connectionTimeoutMillis: connectTimeoutMs,
    }),
    transactionOptions: {
      maxWait: connectTimeoutMs,
      timeout: connectTimeoutMs * 2,
    },
  });
}
