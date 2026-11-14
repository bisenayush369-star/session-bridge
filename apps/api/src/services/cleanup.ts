import type { HandoffService } from './handoff-service.js';
import type { PurgeResult } from './repository.js';

export interface LogLike {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** One idempotent cleanup pass; safe to run concurrently from several instances or from cron. Never throws. */
export async function runCleanup(service: HandoffService, log: LogLike): Promise<PurgeResult | null> {
  try {
    const result = await service.cleanup();
    const stats = await service.stats();
    log.info({ ...result, ...stats }, 'cleanup complete');
    return result;
  } catch (e) {
    const errorName =
      e instanceof Error ? e.name : typeof e === 'object' && e && 'name' in e ? String(e.name) : 'unknown';
    const errorCode =
      typeof e === 'object' && e && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
    const extra = { err: errorName } as Record<string, string>;
    if (errorCode) extra.code = errorCode;
    if (errorCode === 'P2021' || errorCode === 'P2022') {
      extra.hint =
        'database schema is missing or outdated: run `npm run db:migrate:deploy` against the DATABASE_URL database.';
    }
    if (errorCode === 'P2028' || errorCode === 'P2024') {
      extra.hint =
        'database transaction or connection timed out (slow link to the database): raise DB_CONNECT_TIMEOUT_MS or use a database region closer to the server.';
    }
    log.error(extra, 'cleanup failed');
    return null;
  }
}
