import { describe, expect, it } from 'vitest';
import { RequestGuard } from '../apps/api/src/middleware/guard.js';
import { FakeClock, thrown } from './helpers.js';

const rate = {
  createPerMin: 10,
  globalCreatePerMin: 25,
  readPerMin: 5,
  resumePerMin: 5,
  deletePerMin: 5,
  ipPerMin: 4,
  mcpIpPerMin: 6,
  mcpCreatePerMin: 3,
  invalidPerWindow: 3,
  invalidIpPerWindow: 5,
  invalidWindowSeconds: 900,
};
const make = () => {
  const clock = new FakeClock();
  return { clock, guard: new RequestGuard(rate, clock) };
};

describe('RequestGuard', () => {
  it('limits creation per IP with 429 + retry hint, then recovers', () => {
    const { clock, guard } = make();
    for (let i = 0; i < 10; i += 1) guard.checkCreate('1.1.1.1');
    const err = thrown(() => guard.checkCreate('1.1.1.1'));
    expect(err.status).toBe(429);
    expect((err.extra as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    guard.checkCreate('2.2.2.2');
    clock.advance(61_000);
    guard.checkCreate('1.1.1.1');
  });

  it('applies a global creation ceiling across IPs', () => {
    const { guard } = make();
    for (const ip of ['a', 'b']) for (let i = 0; i < 10; i += 1) guard.checkCreate(ip);
    for (let i = 0; i < 5; i += 1) guard.checkCreate('c');
    expect(thrown(() => guard.checkCreate('c')).status).toBe(429);
  });

  it('counts authenticated operations per handoff, not per IP', () => {
    const { guard } = make();
    for (let i = 0; i < 5; i += 1) guard.checkAuthenticated('shared-ip', 'hs_AAAAAAAAAAAAAAAA', 'read');
    expect(thrown(() => guard.checkAuthenticated('shared-ip', 'hs_AAAAAAAAAAAAAAAA', 'read')).status).toBe(429);
    guard.checkAuthenticated('shared-ip', 'hs_BBBBBBBBBBBBBBBB', 'read');
    guard.checkAuthenticated('shared-ip', 'hs_AAAAAAAAAAAAAAAA', 'resume');
  });

  it('blocks repeated invalid credentials only for the offending IP (and handoff), then expires', () => {
    const { clock, guard } = make();
    const X = 'hs_XXXXXXXXXXXXXXXX';
    const Y = 'hs_YYYYYYYYYYYYYYYY';
    for (let i = 0; i < 3; i += 1) guard.recordFailure('evil', X);
    expect(thrown(() => guard.assertNotBlocked('evil', X)).status).toBe(429);
    guard.assertNotBlocked('victim-on-other-ip', X);
    guard.assertNotBlocked('evil', Y);
    guard.recordFailure('evil', Y);
    guard.recordFailure('evil', Y);
    expect(thrown(() => guard.assertNotBlocked('evil', 'hs_ZZZZZZZZZZZZZZZZ')).status).toBe(429);
    clock.advance(901_000);
    guard.assertNotBlocked('evil', X);
  });

  it('gives the hosted MCP channel its own per-IP ceilings (claude.ai shares a few IPs)', () => {
    const { guard } = make();
    for (let i = 0; i < 4; i += 1) guard.checkIp('shared', 'api');
    expect(thrown(() => guard.checkIp('shared', 'api')).status).toBe(429);
    for (let i = 0; i < 6; i += 1) guard.checkIp('shared', 'mcp');
    expect(thrown(() => guard.checkIp('shared', 'mcp')).status).toBe(429);
    for (let i = 0; i < 3; i += 1) guard.checkCreate('s2', 'mcp');
    expect(thrown(() => guard.checkCreate('s2', 'mcp')).status).toBe(429);
    guard.checkCreate('s2', 'api');
  });

  it('enforces a per-IP request ceiling', () => {
    const { guard } = make();
    for (let i = 0; i < 4; i += 1) guard.checkIp('9.9.9.9');
    expect(thrown(() => guard.checkIp('9.9.9.9')).status).toBe(429);
    guard.checkIp('8.8.8.8');
  });
});
