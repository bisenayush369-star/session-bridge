import { describe, expect, it } from 'vitest';
import { computeExpiry, isExpired, resolveRetention } from '../apps/api/src/services/retention.js';
import { DAY, HOUR, thrown } from './helpers.js';

const now = new Date('2026-11-03T10:00:00.000Z');

describe('retention', () => {
  it('computes UTC expiry instants for each policy', () => {
    expect(computeExpiry('24h', now)?.toISOString()).toBe('2026-11-04T10:00:00.000Z');
    expect(computeExpiry('30d', now)?.toISOString()).toBe('2026-12-03T10:00:00.000Z');
    expect(computeExpiry('90d', now)?.toISOString()).toBe('2027-02-01T10:00:00.000Z');
    expect(computeExpiry('persistent', now)).toBeNull();
  });

  it('treats the expiry instant itself as expired and persistent as never expiring', () => {
    const exp = new Date(now.getTime() + DAY);
    expect(isExpired(exp, new Date(exp.getTime() - 1))).toBe(false);
    expect(isExpired(exp, exp)).toBe(true);
    expect(isExpired(null, new Date(now.getTime() + 10_000 * DAY))).toBe(false);
    expect(HOUR).toBe(3_600_000);
  });

  it('defaults to the configured policy and never applies persistent silently', () => {
    expect(resolveRetention(undefined, '30d', true)).toBe('30d');
    expect(resolveRetention('persistent', '30d', true)).toBe('persistent');
  });

  it('rejects unknown policies and disabled persistent retention', () => {
    for (const bad of ['forever', '7d', 30, null, '']) expect(thrown(() => resolveRetention(bad, '30d', true)).status).toBe(400);
    expect(thrown(() => resolveRetention('persistent', '30d', false)).status).toBe(400);
  });
});
