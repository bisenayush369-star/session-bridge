import {
  DuplicateIdError,
  type HandoffRecord,
  type HandoffRepository,
  type NewHandoff,
  type PurgeInput,
  type PurgeResult,
  type StoreStats,
} from './repository.js';

/** In-process repository used by unit/API tests. Not for production: data is lost on restart. */
export class InMemoryHandoffRepository implements HandoffRepository {
  readonly rows = new Map<string, HandoffRecord>();

  async create(handoff: NewHandoff): Promise<void> {
    if (this.rows.has(handoff.publicId)) throw new DuplicateIdError();
    this.rows.set(handoff.publicId, { ...structuredClone(handoff), lastAccessedAt: null, revokedAt: null, deletedAt: null });
  }

  async findByPublicId(publicId: string): Promise<HandoffRecord | null> {
    const row = this.rows.get(publicId);
    return row ? structuredClone(row) : null;
  }

  async touch(publicId: string, at: Date): Promise<void> {
    const row = this.rows.get(publicId);
    if (row) row.lastAccessedAt = at;
  }

  async markDeleted(publicId: string, at: Date): Promise<boolean> {
    const row = this.rows.get(publicId);
    if (!row) return false;
    if (!row.deletedAt) {
      row.deletedAt = at;
      row.memory = {};
      row.payloadBytes = 0;
    }
    return true;
  }

  async markRevoked(publicId: string, at: Date): Promise<boolean> {
    const row = this.rows.get(publicId);
    if (!row) return false;
    row.revokedAt ??= at;
    return true;
  }

  async purge(input: PurgeInput): Promise<PurgeResult> {
    const result: PurgeResult = { expired: 0, tombstones: 0, inactivePersistent: 0 };
    for (const [id, row] of [...this.rows]) {
      if (row.expiresAt && row.expiresAt.getTime() <= input.now.getTime()) {
        this.rows.delete(id);
        result.expired += 1;
      } else if (
        (row.deletedAt && row.deletedAt.getTime() <= input.tombstoneBefore.getTime()) ||
        (row.revokedAt && row.revokedAt.getTime() <= input.tombstoneBefore.getTime())
      ) {
        this.rows.delete(id);
        result.tombstones += 1;
      } else if (
        input.inactiveBefore &&
        row.expiresAt === null &&
        !row.deletedAt &&
        (row.lastAccessedAt ?? row.createdAt).getTime() < input.inactiveBefore.getTime()
      ) {
        this.rows.delete(id);
        result.inactivePersistent += 1;
      }
    }
    return result;
  }

  async stats(now: Date): Promise<StoreStats> {
    const stats: StoreStats = { active: 0, activePayloadBytes: 0, expiredPending: 0, tombstones: 0 };
    for (const row of this.rows.values()) {
      if (row.deletedAt || row.revokedAt) stats.tombstones += 1;
      if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) stats.expiredPending += 1;
      else if (!row.deletedAt && !row.revokedAt) {
        stats.active += 1;
        stats.activePayloadBytes += row.payloadBytes;
      }
    }
    return stats;
  }

  async ping(): Promise<void> {}
}
