import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import {
  DuplicateIdError,
  type HandoffRecord,
  type HandoffRepository,
  type NewHandoff,
  type PurgeInput,
  type PurgeResult,
  type StoreStats,
} from './repository.js';

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';

export class PrismaHandoffRepository implements HandoffRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(h: NewHandoff): Promise<void> {
    try {
      await this.db.handoff.create({
        data: {
          publicId: h.publicId,
          memory: h.memory as Prisma.InputJsonValue,
          schemaVersion: h.schemaVersion,
          tokenHash: h.tokenHash,
          payloadBytes: h.payloadBytes,
          retention: h.retention,
          createdAt: h.createdAt,
          expiresAt: h.expiresAt,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new DuplicateIdError();
      throw e;
    }
  }

  async findByPublicId(publicId: string): Promise<HandoffRecord | null> {
    const r = await this.db.handoff.findUnique({ where: { publicId } });
    if (!r) return null;
    return {
      publicId: r.publicId,
      memory: r.memory,
      schemaVersion: r.schemaVersion,
      tokenHash: r.tokenHash,
      payloadBytes: r.payloadBytes,
      retention: r.retention,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      lastAccessedAt: r.lastAccessedAt,
      revokedAt: r.revokedAt,
      deletedAt: r.deletedAt,
    };
  }

  async touch(publicId: string, at: Date): Promise<void> {
    await this.db.handoff.updateMany({ where: { publicId }, data: { lastAccessedAt: at } });
  }

  async markDeleted(publicId: string, at: Date): Promise<boolean> {
    // One statement both records the deletion and scrubs the stored memory.
    const r = await this.db.handoff.updateMany({
      where: { publicId, deletedAt: null },
      data: { deletedAt: at, memory: {}, payloadBytes: 0 },
    });
    if (r.count > 0) return true;
    return (await this.db.handoff.count({ where: { publicId } })) > 0;
  }

  async markRevoked(publicId: string, at: Date): Promise<boolean> {
    const r = await this.db.handoff.updateMany({
      where: { publicId, revokedAt: null },
      data: { revokedAt: at },
    });
    if (r.count > 0) return true;
    return (await this.db.handoff.count({ where: { publicId } })) > 0;
  }

  async purge(i: PurgeInput): Promise<PurgeResult> {
    const ops = [
      this.db.handoff.deleteMany({ where: { expiresAt: { lte: i.now } } }),
      this.db.handoff.deleteMany({
        where: { OR: [{ deletedAt: { lte: i.tombstoneBefore } }, { revokedAt: { lte: i.tombstoneBefore } }] },
      }),
    ];
    if (i.inactiveBefore) {
      ops.push(
        this.db.handoff.deleteMany({
          where: {
            expiresAt: null,
            deletedAt: null,
            OR: [
              { lastAccessedAt: { lt: i.inactiveBefore } },
              { lastAccessedAt: null, createdAt: { lt: i.inactiveBefore } },
            ],
          },
        }),
      );
    }
    const res = await this.db.$transaction(ops);
    return {
      expired: res[0]?.count ?? 0,
      tombstones: res[1]?.count ?? 0,
      inactivePersistent: res[2]?.count ?? 0,
    };
  }

  async stats(now: Date): Promise<StoreStats> {
    const [active, expiredPending, tombstones] = await this.db.$transaction([
      this.db.handoff.aggregate({
        where: { deletedAt: null, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        _count: { _all: true },
        _sum: { payloadBytes: true },
      }),
      this.db.handoff.count({ where: { expiresAt: { lte: now } } }),
      this.db.handoff.count({ where: { OR: [{ deletedAt: { not: null } }, { revokedAt: { not: null } }] } }),
    ]);
    return {
      active: active._count._all,
      activePayloadBytes: active._sum.payloadBytes ?? 0,
      expiredPending,
      tombstones,
    };
  }

  async ping(): Promise<void> {
    await this.db.$queryRaw`SELECT 1`;
  }
}
