import { describe, expect, it } from 'vitest';
import { RequestGuard } from '../apps/api/src/middleware/guard.js';
import { assertMcpAccess } from '../apps/api/src/middleware/mcp-access.js';
import { FakeClock, thrown } from './helpers.js';

const KEY = 'k'.repeat(32);
const rate = {
  createPerMin: 10,
  globalCreatePerMin: 25,
  readPerMin: 5,
  resumePerMin: 5,
  deletePerMin: 5,
  ipPerMin: 100,
  mcpIpPerMin: 100,
  mcpCreatePerMin: 10,
  invalidPerWindow: 3,
  invalidIpPerWindow: 50,
  invalidWindowSeconds: 900,
};
const make = () => new RequestGuard(rate, new FakeClock());

describe('assertMcpAccess', () => {
  it('leaves the endpoint open when no key is configured', () => {
    assertMcpAccess(make(), 'ip', undefined, {});
  });

  it('accepts the key in X-Session-Bridge-Key or as a Bearer token', () => {
    const guard = make();
    assertMcpAccess(guard, 'ip', KEY, { 'x-session-bridge-key': KEY });
    assertMcpAccess(guard, 'ip', KEY, { authorization: `Bearer ${KEY}` });
    assertMcpAccess(guard, 'ip', KEY, { authorization: `bearer ${KEY}` });
  });

  it('rejects missing, wrong and truncated keys with 401', () => {
    for (const headers of [
      {},
      { 'x-session-bridge-key': 'nope' },
      { 'x-session-bridge-key': KEY.slice(1) },
      { authorization: 'Bearer ' },
    ]) {
      expect(thrown(() => assertMcpAccess(make(), 'ip', KEY, headers)).status).toBe(401); // fresh guard: stays under the failure limit
    }
  });

  it('throttles repeated wrong keys per IP without affecting other IPs', () => {
    const guard = make();
    for (let i = 0; i < 3; i += 1)
      expect(thrown(() => assertMcpAccess(guard, 'evil', KEY, { 'x-session-bridge-key': 'x' })).status).toBe(
        401,
      );
    expect(thrown(() => assertMcpAccess(guard, 'evil', KEY, { 'x-session-bridge-key': KEY })).status).toBe(
      429,
    );
    assertMcpAccess(guard, 'friend', KEY, { 'x-session-bridge-key': KEY });
  });
});
