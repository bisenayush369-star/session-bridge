// Integration tests against a real PostgreSQL database. Skipped unless DATABASE_URL_TEST is set.
// Prepare once:  DATABASE_URL=$DATABASE_URL_TEST npx prisma migrate deploy
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrisma } from '../apps/api/src/db.js';
import { HandoffService } from '../apps/api/src/services/handoff-service.js';
import { PrismaHandoffRepository } from '../apps/api/src/services/prisma-repository.js';
import { DuplicateIdError, type NewHandoff } from '../apps/api/src/services/repository.js';
import { DAY, makeService, rejection, sampleInput, TEST_PEPPER } from './helpers.js';

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)('PrismaHandoffRepository (PostgreSQL)', () => {
  const prisma = createPrisma(url ?? 'postgresql://invalid', 2);
  const repo = new PrismaHandoffRepository(prisma);
  const now = new Date('2026-11-03T00:00:00.000Z');
  const row = (id: string, over: Partial<NewHandoff> = {}): NewHandoff => ({
    publicId: id,
    memory: { hello: 'world' },
    schemaVersion: 1,
    tokenHash: 'a'.repeat(64),
    payloadBytes: 17,
    retention: '30d',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 30 * DAY),
    ...over,
  });

  beforeAll(() => prisma.$queryRaw`SELECT 1`);
  beforeEach(async () => {
    await prisma.handoff.deleteMany();
  });
  afterAll(() => prisma.$disconnect());

  it('round-trips a record and enforces unique public ids', async () => {
    await repo.create(row('hs_DBTEST0000000001'));
    const found = await repo.findByPublicId('hs_DBTEST0000000001');
    expect(found?.memory).toEqual({ hello: 'world' });
    expect(found?.expiresAt?.toISOString()).toBe('2026-12-03T00:00:00.000Z');
    expect(await repo.findByPublicId('hs_DBTEST0000000002')).toBeNull();
    expect((await rejection(repo.create(row('hs_DBTEST0000000001')))) instanceof DuplicateIdError).toBe(true);
  });

  it('scrubs on delete, keeps an idempotent tombstone and revokes', async () => {
    await repo.create(row('hs_DBTEST0000000003'));
    expect(await repo.markDeleted('hs_DBTEST0000000003', now)).toBe(true);
    expect(await repo.markDeleted('hs_DBTEST0000000003', now)).toBe(true);
    expect(await repo.markDeleted('hs_DBTEST0000000099', now)).toBe(false);
    const found = await repo.findByPublicId('hs_DBTEST0000000003');
    expect(found?.memory).toEqual({});
    expect(found?.deletedAt).not.toBeNull();
    await repo.create(row('hs_DBTEST0000000004'));
    expect(await repo.markRevoked('hs_DBTEST0000000004', now)).toBe(true);
    expect((await repo.findByPublicId('hs_DBTEST0000000004'))?.revokedAt).not.toBeNull();
  });

  it('purges expired rows, old tombstones and inactive persistent rows idempotently', async () => {
    await repo.create(row('hs_DBTEST0000000005', { expiresAt: new Date(now.getTime() - 1_000) }));
    await repo.create(row('hs_DBTEST0000000006', { retention: 'persistent', expiresAt: null, createdAt: new Date(now.getTime() - 400 * DAY) }));
    await repo.create(row('hs_DBTEST0000000007'));
    await repo.markDeleted('hs_DBTEST0000000007', new Date(now.getTime() - 8 * DAY));
    await repo.create(row('hs_DBTEST0000000008'));
    const input = { now, tombstoneBefore: new Date(now.getTime() - 7 * DAY), inactiveBefore: new Date(now.getTime() - 365 * DAY) };
    expect(await repo.purge(input)).toEqual({ expired: 1, tombstones: 1, inactivePersistent: 1 });
    expect(await repo.purge(input)).toEqual({ expired: 0, tombstones: 0, inactivePersistent: 0 });
    expect(await repo.findByPublicId('hs_DBTEST0000000008')).not.toBeNull();
    expect((await repo.stats(now)).active).toBe(1);
  });

  it('persists through the full service flow', async () => {
    const service = new HandoffService({
      repo,
      config: { ...makeService().config, tokenPepper: TEST_PEPPER },
      now: () => now,
    });
    const created = await service.create(sampleInput());
    const got = await service.get(created.handoff_id, created.retrieval_token);
    expect(got.memory.objective).toBe('Fix authentication');
    await service.remove(created.handoff_id, created.retrieval_token);
    expect((await rejection(service.get(created.handoff_id, created.retrieval_token))).status).toBe(404);
  });
});
