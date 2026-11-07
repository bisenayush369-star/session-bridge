import { describe, expect, it } from 'vitest';
import { FixedWindowLimiter } from '../apps/api/src/middleware/rate-limit.js';
import { FakeClock } from './helpers.js';

describe('FixedWindowLimiter', () => {
  it('allows the limit, blocks beyond it with a retry hint, then resets', () => {
    const clock = new FakeClock();
    const l = new FixedWindowLimiter(3, 1_000, clock);
    expect([1, 2, 3].map(() => l.hit('k').allowed)).toEqual([true, true, true]);
    const blocked = l.hit('k');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
    clock.advance(1_000);
    expect(l.hit('k').allowed).toBe(true);
  });

  it('keeps keys independent and reports blocked state without counting', () => {
    const clock = new FakeClock();
    const l = new FixedWindowLimiter(2, 10_000, clock);
    l.hit('a');
    expect(l.isBlocked('a').blocked).toBe(false);
    l.hit('a');
    expect(l.isBlocked('a').blocked).toBe(true);
    expect(l.isBlocked('a').retryAfterSeconds).toBe(10);
    expect(l.hit('b').allowed).toBe(true);
    clock.advance(10_000);
    expect(l.isBlocked('a').blocked).toBe(false);
  });

  it('stays within its key bound', () => {
    const clock = new FakeClock();
    const l = new FixedWindowLimiter(1, 60_000, clock, 3);
    for (const k of ['a', 'b', 'c', 'd', 'e']) l.hit(k);
    expect(l.size).toBeLessThanOrEqual(3);
    clock.advance(60_000);
    l.sweep();
    expect(l.size).toBe(0);
  });
});
