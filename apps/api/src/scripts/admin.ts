/** Operator CLI: `cleanup` (one idempotent pass, for cron), `stats`, `revoke <handoff_id>`. */
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { createPrisma } from '../db.js';
import { runCleanup } from '../services/cleanup.js';
import { HandoffService } from '../services/handoff-service.js';
import { PrismaHandoffRepository } from '../services/prisma-repository.js';

const [command, arg] = process.argv.slice(2);
const out = (value: unknown): void => void process.stdout.write(`${JSON.stringify(value)}\n`);

const config = loadConfig();
if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
const prisma = createPrisma(config.databaseUrl, 2);
const service = new HandoffService({ repo: new PrismaHandoffRepository(prisma), config });

try {
  if (command === 'cleanup') {
    out(await runCleanup(service, { info: (o) => out(o), error: (o) => out(o) }));
  } else if (command === 'stats') {
    out(await service.stats());
  } else if (command === 'revoke' && arg) {
    out({ revoked: await service.revoke(arg) });
  } else {
    process.stderr.write('usage: admin.ts cleanup | stats | revoke <handoff_id>\n');
    process.exitCode = 2;
  }
} finally {
  await prisma.$disconnect();
}
