import { z } from 'zod';
import type { Retention } from '@session-bridge/shared';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const int = (def: number, min = 0, max = 2_147_483_647) =>
  z.coerce.number().int().min(min).max(max).default(def);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: int(3000, 1, 65_535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1).optional(),
  DB_POOL_MAX: int(10, 1, 200),
  DB_CONNECT_TIMEOUT_MS: int(15_000, 1_000, 120_000),
  HEALTH_DB_TIMEOUT_MS: int(5_000, 500, 60_000),
  TOKEN_PEPPER: z.string().min(32, 'must be at least 32 characters'),
  TRUST_PROXY: z.string().default('false'),
  MCP_ACCESS_TOKEN: z.string().min(24, 'must be at least 24 characters').optional(),
  REQUIRE_HTTPS: bool.optional(),
  MAX_BODY_BYTES: int(262_144, 1_024, 10_485_760),
  MEMORY_BUDGET_BYTES: int(65_536, 2_048, 5_242_880),
  DEFAULT_RETENTION: z.enum(['24h', '30d', '90d']).default('30d'),
  ALLOW_PERSISTENT_RETENTION: bool.default('true'),
  PERSISTENT_INACTIVITY_DAYS: int(365, 0, 36_500),
  TOMBSTONE_DAYS: int(7, 0, 365),
  CLEANUP_INTERVAL_MINUTES: int(60, 0, 10_080),
  REDACT_SECRETS: bool.default('true'),
  MAX_CONCURRENT_REQUESTS: int(200, 1, 100_000),
  RATE_LIMIT_CREATE_PER_MIN: int(10, 1),
  RATE_LIMIT_GLOBAL_CREATE_PER_MIN: int(600, 1),
  RATE_LIMIT_READ_PER_MIN: int(60, 1),
  RATE_LIMIT_RESUME_PER_MIN: int(30, 1),
  RATE_LIMIT_DELETE_PER_MIN: int(10, 1),
  RATE_LIMIT_IP_PER_MIN: int(300, 1),
  RATE_LIMIT_MCP_IP_PER_MIN: int(1200, 1),
  RATE_LIMIT_MCP_CREATE_PER_MIN: int(60, 1),
  RATE_LIMIT_INVALID_PER_WINDOW: int(10, 1),
  RATE_LIMIT_INVALID_IP_PER_WINDOW: int(50, 1),
  RATE_LIMIT_INVALID_WINDOW_SECONDS: int(900, 1),
});

export interface RateConfig {
  createPerMin: number;
  globalCreatePerMin: number;
  readPerMin: number;
  resumePerMin: number;
  deletePerMin: number;
  ipPerMin: number;
  mcpIpPerMin: number;
  mcpCreatePerMin: number;
  invalidPerWindow: number;
  invalidIpPerWindow: number;
  invalidWindowSeconds: number;
}

export interface Config {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string | undefined;
  dbPoolMax: number;
  dbConnectTimeoutMs: number;
  healthTimeoutMs: number;
  tokenPepper: string;
  /** Optional shared key required on POST /mcp (claude.ai connector request header). */
  mcpAccessToken: string | undefined;
  trustProxy: boolean | string | string[];
  requireHttps: boolean;
  maxBodyBytes: number;
  memoryBudgetBytes: number;
  defaultRetention: Retention;
  allowPersistent: boolean;
  persistentInactivityDays: number;
  tombstoneDays: number;
  cleanupIntervalMinutes: number;
  redactSecrets: boolean;
  maxConcurrentRequests: number;
  rate: RateConfig;
}

function parseTrustProxy(value: string): boolean | string {
  if (value === 'true') return true;
  if (value === 'false' || value === '') return false;
  return value; // hop count, comma-separated IPs / CIDRs, or CIDR list
}

/** Validates the environment once at startup. Error text names variables, never their values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  if (production && !e.DATABASE_URL)
    throw new Error('Invalid environment configuration: DATABASE_URL is required in production');
  if (production && /CHANGE_?ME/i.test(e.TOKEN_PEPPER)) {
    throw new Error('Invalid environment configuration: TOKEN_PEPPER still has the placeholder value');
  }
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    dbPoolMax: e.DB_POOL_MAX,
    dbConnectTimeoutMs: e.DB_CONNECT_TIMEOUT_MS,
    healthTimeoutMs: e.HEALTH_DB_TIMEOUT_MS,
    tokenPepper: e.TOKEN_PEPPER,
    mcpAccessToken: e.MCP_ACCESS_TOKEN,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    requireHttps: e.REQUIRE_HTTPS ?? production,
    maxBodyBytes: e.MAX_BODY_BYTES,
    memoryBudgetBytes: e.MEMORY_BUDGET_BYTES,
    defaultRetention: e.DEFAULT_RETENTION,
    allowPersistent: e.ALLOW_PERSISTENT_RETENTION,
    persistentInactivityDays: e.PERSISTENT_INACTIVITY_DAYS,
    tombstoneDays: e.TOMBSTONE_DAYS,
    cleanupIntervalMinutes: e.CLEANUP_INTERVAL_MINUTES,
    redactSecrets: e.REDACT_SECRETS,
    maxConcurrentRequests: e.MAX_CONCURRENT_REQUESTS,
    rate: {
      createPerMin: e.RATE_LIMIT_CREATE_PER_MIN,
      globalCreatePerMin: e.RATE_LIMIT_GLOBAL_CREATE_PER_MIN,
      readPerMin: e.RATE_LIMIT_READ_PER_MIN,
      resumePerMin: e.RATE_LIMIT_RESUME_PER_MIN,
      deletePerMin: e.RATE_LIMIT_DELETE_PER_MIN,
      ipPerMin: e.RATE_LIMIT_IP_PER_MIN,
      mcpIpPerMin: e.RATE_LIMIT_MCP_IP_PER_MIN,
      mcpCreatePerMin: e.RATE_LIMIT_MCP_CREATE_PER_MIN,
      invalidPerWindow: e.RATE_LIMIT_INVALID_PER_WINDOW,
      invalidIpPerWindow: e.RATE_LIMIT_INVALID_IP_PER_WINDOW,
      invalidWindowSeconds: e.RATE_LIMIT_INVALID_WINDOW_SECONDS,
    },
  };
}
