import { RETENTION_VALUES, type Retention } from '@session-bridge/shared';
import { errors } from '../errors.js';

const DAY = 86_400_000;
const DURATION_MS = { '24h': DAY, '30d': 30 * DAY, '90d': 90 * DAY } as const;

export function isRetention(value: unknown): value is Retention {
  return typeof value === 'string' && (RETENTION_VALUES as readonly string[]).includes(value);
}

/** Server-side validation: client-supplied expiry values are never trusted; only the named policies exist. */
export function resolveRetention(
  requested: unknown,
  defaultPolicy: Retention,
  allowPersistent: boolean,
): Retention {
  const policy = requested === undefined ? defaultPolicy : requested;
  if (!isRetention(policy))
    throw errors.validation(`retention must be one of: ${RETENTION_VALUES.join(', ')}.`);
  if (policy === 'persistent' && !allowPersistent)
    throw errors.validation('Persistent retention is disabled on this server.');
  return policy;
}

/** Expiry instant (UTC epoch based). `null` means persistent: kept until deleted or purged for inactivity. */
export function computeExpiry(policy: Retention, now: Date): Date | null {
  return policy === 'persistent' ? null : new Date(now.getTime() + DURATION_MS[policy]);
}

export function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}
