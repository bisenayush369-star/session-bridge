import type { RateConfig } from '../config.js';
import { errors } from '../errors.js';
import { FixedWindowLimiter, systemClock, type Clock } from './rate-limit.js';

export type Operation = 'read' | 'resume' | 'delete';
/** `mcp` is the hosted MCP endpoint: claude.ai calls it from a few shared Anthropic IPs, so it gets higher per-IP ceilings. */
export type Channel = 'api' | 'mcp';
const MINUTE = 60_000;

/**
 * Layered abuse protection (all in-memory, per instance):
 *  1. per-IP request ceiling                      (checkIp)
 *  2. creation: per-IP and global                 (checkCreate)
 *  3. authenticated operations: per handoff       (checkAuthenticated; counted only AFTER the token verified,
 *     so someone who merely knows a handoff ID cannot use up its allowance)
 *  4. invalid credentials: per IP+handoff and per IP (assertNotBlocked / recordFailure; keyed by IP so an
 *     attacker elsewhere cannot lock a legitimate user out)
 */
export class RequestGuard {
  private readonly ip: Record<Channel, FixedWindowLimiter>;
  private readonly createIp: Record<Channel, FixedWindowLimiter>;
  private readonly createGlobal: FixedWindowLimiter;
  private readonly ops: Record<Operation, FixedWindowLimiter>;
  private readonly failPair: FixedWindowLimiter;
  private readonly failIp: FixedWindowLimiter;

  constructor(rate: RateConfig, clock: Clock = systemClock) {
    const failWindow = rate.invalidWindowSeconds * 1000;
    this.ip = {
      api: new FixedWindowLimiter(rate.ipPerMin, MINUTE, clock),
      mcp: new FixedWindowLimiter(rate.mcpIpPerMin, MINUTE, clock),
    };
    this.createIp = {
      api: new FixedWindowLimiter(rate.createPerMin, MINUTE, clock),
      mcp: new FixedWindowLimiter(rate.mcpCreatePerMin, MINUTE, clock),
    };
    this.createGlobal = new FixedWindowLimiter(rate.globalCreatePerMin, MINUTE, clock);
    this.ops = {
      read: new FixedWindowLimiter(rate.readPerMin, MINUTE, clock),
      resume: new FixedWindowLimiter(rate.resumePerMin, MINUTE, clock),
      delete: new FixedWindowLimiter(rate.deletePerMin, MINUTE, clock),
    };
    this.failPair = new FixedWindowLimiter(rate.invalidPerWindow, failWindow, clock);
    this.failIp = new FixedWindowLimiter(rate.invalidIpPerWindow, failWindow, clock);
  }

  private enforce(limiter: FixedWindowLimiter, key: string): void {
    const r = limiter.hit(key);
    if (!r.allowed) throw errors.rateLimited(r.retryAfterSeconds);
  }

  checkIp(ip: string, channel: Channel = 'api'): void {
    this.enforce(this.ip[channel], ip);
  }

  checkCreate(ip: string, channel: Channel = 'api'): void {
    this.enforce(this.createIp[channel], ip);
    this.enforce(this.createGlobal, 'global');
  }

  checkAuthenticated(_ip: string, handoffId: string, op: Operation): void {
    this.enforce(this.ops[op], handoffId);
  }

  assertNotBlocked(ip: string, handoffId: string): void {
    for (const [limiter, key] of [
      [this.failPair, `${ip}|${handoffId}`],
      [this.failIp, ip],
    ] as const) {
      const s = limiter.isBlocked(key);
      if (s.blocked) throw errors.rateLimited(s.retryAfterSeconds);
    }
  }

  recordFailure(ip: string, handoffId: string): void {
    this.failPair.hit(`${ip}|${handoffId}`);
    this.failIp.hit(ip);
  }

  sweep(): void {
    const all = [
      ...Object.values(this.ip),
      ...Object.values(this.createIp),
      this.createGlobal,
      ...Object.values(this.ops),
      this.failPair,
      this.failIp,
    ];
    for (const limiter of all) limiter.sweep();
  }
}
