import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPrisma } from './db.js';
import { RequestGuard } from './middleware/guard.js';
import { runCleanup } from './services/cleanup.js';
import { HandoffService } from './services/handoff-service.js';
import { PrismaHandoffRepository } from './services/prisma-repository.js';

const config = loadConfig();
if (!config.databaseUrl) throw new Error('DATABASE_URL is required');

const prisma = createPrisma(config.databaseUrl, config.dbPoolMax);
const repo = new PrismaHandoffRepository(prisma);
const service = new HandoffService({ repo, config });
const guard = new RequestGuard(config.rate);
const app = buildApp({ config, service, guard, repo });

const timers: NodeJS.Timeout[] = [setInterval(() => guard.sweep(), 60_000)];
if (config.cleanupIntervalMinutes > 0) {
  timers.push(setInterval(() => void runCleanup(service, app.log), config.cleanupIntervalMinutes * 60_000));
  timers.push(setTimeout(() => void runCleanup(service, app.log), 5_000));
}
for (const t of timers) t.unref();

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  setTimeout(() => process.exit(1), 10_000).unref();
  try {
    await app.close(); // stops accepting connections and waits for in-flight requests
    await prisma.$disconnect();
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (e) {
  app.log.error({ errType: e instanceof Error ? e.name : 'unknown' }, 'failed to start');
  process.exit(1);
}
