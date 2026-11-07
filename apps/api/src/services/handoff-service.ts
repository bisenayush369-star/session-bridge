import {
  applyBudget,
  buildResume,
  byteSize,
  estimateTokens,
  HANDOFF_ID_PATTERN,
  MemoryTooLargeError,
  normalizeMemory,
  redactDeep,
  SCHEMA_VERSION,
  TOKEN_ESTIMATE_NOTE,
  type MemoryInput,
  type MemoryV1,
  type Retention,
} from '@session-bridge/shared';
import { AppError, errors } from '../errors.js';
import { generateHandoffId, generateRetrievalToken, hashToken, verifyToken } from './credentials.js';
import { computeExpiry, isExpired, resolveRetention } from './retention.js';
import {
  DuplicateIdError,
  type HandoffRecord,
  type HandoffRepository,
  type PurgeResult,
  type StoreStats,
} from './repository.js';

const DAY = 86_400_000;

export interface ServiceConfig {
  tokenPepper: string;
  defaultRetention: Retention;
  allowPersistent: boolean;
  memoryBudgetBytes: number;
  redactSecrets: boolean;
  persistentInactivityDays: number;
  tombstoneDays: number;
}

export interface ServiceDeps {
  repo: HandoffRepository;
  config: ServiceConfig;
  now?: () => Date;
  generateId?: () => string;
  generateToken?: () => string;
}

export type CreateInput = MemoryInput & { retention?: unknown };

/** `afterAuth` runs once the token is verified and before any work; it may throw (e.g. per-handoff rate limits). */
export interface Hooks {
  afterAuth?: () => void;
}

export interface CreateResult {
  handoff_id: string;
  retrieval_token: string;
  expires_at: string | null;
  status: 'active';
  retention: Retention;
  payload_bytes: number;
  truncated: boolean;
  warnings: string[];
}

export interface ResumeOutput {
  handoff_id: string;
  text?: string;
  package?: MemoryV1;
  approx_tokens: number;
  token_estimate: string;
  truncated: boolean;
  omitted: Record<string, number>;
  over_budget: boolean;
  archive: { available: false; reference: null };
}

export class HandoffService {
  private readonly dummyHash: string;

  constructor(private readonly deps: ServiceDeps) {
    this.dummyHash = hashToken('session-bridge-dummy-token', deps.config.tokenPepper);
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  async create(input: CreateInput): Promise<CreateResult> {
    const cfg = this.deps.config;
    const { retention: requested, ...rest } = input;
    const retention = resolveRetention(requested, cfg.defaultRetention, cfg.allowPersistent);

    let data: MemoryInput = rest;
    let redactions = 0;
    if (cfg.redactSecrets) {
      const r = redactDeep(rest);
      data = r.value;
      redactions = r.count;
    }
    let memory = normalizeMemory(data);
    if (!memory.project.name || !memory.objective || !memory.next_action) {
      throw errors.validation('project.name, objective and next_action must contain visible text.');
    }
    try {
      memory = applyBudget(memory, cfg.memoryBudgetBytes);
    } catch (e) {
      if (e instanceof MemoryTooLargeError) {
        throw errors.tooLarge(
          'Memory is too large even after deterministic reduction; shorten objective or constraints.',
        );
      }
      throw e;
    }

    const warnings = [...(memory.omitted?.notes ?? [])];
    if (redactions > 0) {
      warnings.push(
        `${redactions} secret-like value(s) were redacted. Automated detection is imperfect; review your input.`,
      );
    }
    const createdAt = this.now();
    const expiresAt = computeExpiry(retention, createdAt);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const publicId = (this.deps.generateId ?? generateHandoffId)();
      const token = (this.deps.generateToken ?? generateRetrievalToken)();
      try {
        await this.deps.repo.create({
          publicId,
          memory,
          schemaVersion: SCHEMA_VERSION,
          tokenHash: hashToken(token, cfg.tokenPepper),
          payloadBytes: byteSize(memory),
          retention,
          createdAt,
          expiresAt,
        });
        return {
          handoff_id: publicId,
          retrieval_token: token,
          expires_at: expiresAt ? expiresAt.toISOString() : null,
          status: 'active',
          retention,
          payload_bytes: byteSize(memory),
          truncated: memory.omitted !== undefined,
          warnings,
        };
      } catch (e) {
        if (!(e instanceof DuplicateIdError)) throw e;
      }
    }
    throw new AppError(500, 'internal_error', 'Could not allocate a unique handoff id.');
  }

  async get(id: string, token: string, hooks: Hooks = {}) {
    const rec = await this.authorize(id, token);
    hooks.afterAuth?.();
    await this.touchIfStale(rec);
    const memory = rec.memory as MemoryV1;
    return {
      handoff_id: rec.publicId,
      status: 'active' as const,
      retention: rec.retention,
      created_at: rec.createdAt.toISOString(),
      expires_at: rec.expiresAt ? rec.expiresAt.toISOString() : null,
      schema_version: rec.schemaVersion,
      payload_bytes: rec.payloadBytes,
      approx_tokens: estimateTokens(JSON.stringify(memory)).approx_tokens,
      token_estimate: TOKEN_ESTIMATE_NOTE,
      memory,
    };
  }

  async resume(
    id: string,
    token: string,
    opts: { maxTokens?: number; format?: 'text' | 'json' | 'both' } = {},
    hooks: Hooks = {},
  ): Promise<ResumeOutput> {
    const rec = await this.authorize(id, token);
    hooks.afterAuth?.();
    await this.touchIfStale(rec);
    const r = buildResume(rec.memory as MemoryV1, {
      handoffId: rec.publicId,
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    });
    const format = opts.format ?? 'text';
    return {
      handoff_id: rec.publicId,
      ...(format !== 'json' ? { text: r.text } : {}),
      ...(format !== 'text' ? { package: r.memory } : {}),
      approx_tokens: r.approx_tokens,
      token_estimate: r.token_estimate,
      truncated: r.truncated,
      omitted: r.omitted,
      over_budget: r.over_budget,
      archive: r.archive,
    };
  }

  /** Idempotent: memory is scrubbed on the first call; later calls with the same token succeed until the tombstone is purged. */
  async remove(
    id: string,
    token: string,
    hooks: Hooks = {},
  ): Promise<{ handoff_id: string; status: 'deleted' }> {
    await this.authorize(id, token, { lenient: true });
    hooks.afterAuth?.();
    await this.deps.repo.markDeleted(id, this.now());
    return { handoff_id: id, status: 'deleted' };
  }

  /** Operator action (no public route): disables a handoff immediately. Returns false if unknown. */
  async revoke(id: string): Promise<boolean> {
    return this.deps.repo.markRevoked(id, this.now());
  }

  async cleanup(): Promise<PurgeResult> {
    const cfg = this.deps.config;
    const now = this.now();
    return this.deps.repo.purge({
      now,
      tombstoneBefore: new Date(now.getTime() - cfg.tombstoneDays * DAY),
      inactiveBefore:
        cfg.persistentInactivityDays > 0
          ? new Date(now.getTime() - cfg.persistentInactivityDays * DAY)
          : null,
    });
  }

  stats(): Promise<StoreStats> {
    return this.deps.repo.stats(this.now());
  }

  /**
   * Unknown id, wrong token and deleted handoffs all produce the same 404 so existence is not revealed.
   * A dummy hash is compared when the row is missing to keep timing similar.
   */
  private async authorize(
    id: string,
    token: string,
    opts: { lenient?: boolean } = {},
  ): Promise<HandoffRecord> {
    if (!HANDOFF_ID_PATTERN.test(id)) throw errors.notFound();
    const rec = await this.deps.repo.findByPublicId(id);
    const valid = verifyToken(token, rec?.tokenHash ?? this.dummyHash, this.deps.config.tokenPepper);
    if (!rec || !valid) throw errors.notFound();
    if (opts.lenient) return rec;
    if (rec.deletedAt) throw errors.notFound();
    if (rec.revokedAt) throw errors.gone('revoked');
    if (isExpired(rec.expiresAt, this.now())) throw errors.gone('expired');
    return rec;
  }

  private async touchIfStale(rec: HandoffRecord): Promise<void> {
    const now = this.now();
    if (!rec.lastAccessedAt || now.getTime() - rec.lastAccessedAt.getTime() >= DAY) {
      await this.deps.repo.touch(rec.publicId, now);
    }
  }
}
