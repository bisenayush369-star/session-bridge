import { createHash, timingSafeEqual } from 'node:crypto';
import { errors } from '../errors.js';
import type { RequestGuard } from './guard.js';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
type Headers = Record<string, string | string[] | undefined>;

/**
 * Optional shared key for the hosted MCP endpoint. When MCP_ACCESS_TOKEN is unset the endpoint stays open (each
 * handoff is still protected by its own token). When set, the caller must send it as `X-Session-Bridge-Key: <key>`
 * or `Authorization: Bearer <key>`. Wrong keys count as failures and are throttled per client IP.
 */
export function assertMcpAccess(guard: RequestGuard, ip: string, expected: string | undefined, headers: Headers): void {
  if (!expected) return;
  guard.assertNotBlocked(ip, 'mcp-access');
  const raw = headers['x-session-bridge-key'] ?? headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const presented = (value ?? '').replace(/^Bearer\s+/i, '');
  if (!timingSafeEqual(digest(presented), digest(expected))) {
    guard.recordFailure(ip, 'mcp-access');
    throw errors.mcpUnauthorized();
  }
}
