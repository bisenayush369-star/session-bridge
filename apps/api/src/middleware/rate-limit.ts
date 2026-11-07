export interface Clock {
  now(): number;
}
export const systemClock: Clock = { now: () => Date.now() };

export interface HitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * In-memory fixed-window counter. State is per process: with several server instances each enforces its own
 * limit (effective limit = limit x instances). Fixed windows allow up to 2x bursts across a window boundary.
 * Swap in a shared store (e.g. Redis) only if a multi-instance deployment needs exact global limits.
 */
export class FixedWindowLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock = systemClock,
    private readonly maxKeys = 100_000,
  ) {}

  get size(): number {
    return this.buckets.size;
  }

  /** Counts one request for `key`. */
  hit(key: string): HitResult {
    const now = this.clock.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.makeRoom(now);
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= this.limit,
      remaining: Math.max(0, this.limit - bucket.count),
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  /** True once `key` has used its whole allowance in the current window. Does not count. */
  isBlocked(key: string): { blocked: boolean; retryAfterSeconds: number } {
    const now = this.clock.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now || bucket.count < this.limit)
      return { blocked: false, retryAfterSeconds: 0 };
    return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  sweep(): void {
    const now = this.clock.now();
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }

  private makeRoom(now: number): void {
    if (this.buckets.size < this.maxKeys) return;
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
    if (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next();
      if (!oldest.done) this.buckets.delete(oldest.value);
    }
  }
}
