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
    log.error({ err: e instanceof Error ? e.name : 'unknown' }, 'cleanup failed');
    return null;
  }
}
