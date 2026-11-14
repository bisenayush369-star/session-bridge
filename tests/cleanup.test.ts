import { describe, expect, it } from 'vitest';
import { runCleanup } from '../apps/api/src/services/cleanup.js';

describe('runCleanup', () => {
  it('logs the name and code but never the message; adds the migration hint for P2021/P2022', async () => {
    const events: Array<{ kind: 'info' | 'error'; payload: unknown; msg: string }> = [];
    const log: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void } = {
      info: (obj: unknown, msg: string) => events.push({ kind: 'info', payload: obj, msg }),
      error: (obj: unknown, msg: string) => events.push({ kind: 'error', payload: obj, msg }),
    };
    const err = Object.assign(new Error('schema mismatch'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2022',
    });
    const service: {
      cleanup: () => Promise<never>;
      stats: () => Promise<{
        active: number;
        activePayloadBytes: number;
        expiredPending: number;
        tombstones: number;
      }>;
    } = {
      cleanup: async () => {
        throw err;
      },
      stats: async () => ({ active: 0, activePayloadBytes: 0, expiredPending: 0, tombstones: 0 }),
    };

    await runCleanup(
      service as unknown as Parameters<typeof runCleanup>[0],
      log as unknown as Parameters<typeof runCleanup>[1],
    );

    expect(events).toHaveLength(1);
    const errorEvent = events[0]!;
    expect(errorEvent.kind).toBe('error');
    expect(errorEvent.msg).toBe('cleanup failed');
    expect(errorEvent.payload).toMatchObject({
      err: 'PrismaClientKnownRequestError',
      code: 'P2022',
      hint: expect.stringContaining('npm run db:migrate:deploy'),
    });
    expect(JSON.stringify(errorEvent.payload)).not.toContain('schema mismatch');
  });

  it('adds the slow-link timeout hint for P2028 and P2024 without logging the error message text', async () => {
    for (const code of ['P2028', 'P2024']) {
      const events: Array<{ kind: 'info' | 'error'; payload: unknown; msg: string }> = [];
      const log: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void } = {
        info: (obj: unknown, msg: string) => events.push({ kind: 'info', payload: obj, msg }),
        error: (obj: unknown, msg: string) => events.push({ kind: 'error', payload: obj, msg }),
      };
      const errMessage = `slow link ${code} details`;
      const err = Object.assign(new Error(errMessage), {
        name: 'PrismaClientKnownRequestError',
        code,
      });
      const service: {
        cleanup: () => Promise<never>;
        stats: () => Promise<{
          active: number;
          activePayloadBytes: number;
          expiredPending: number;
          tombstones: number;
        }>;
      } = {
        cleanup: async () => {
          throw err;
        },
        stats: async () => ({ active: 0, activePayloadBytes: 0, expiredPending: 0, tombstones: 0 }),
      };

      await runCleanup(
        service as unknown as Parameters<typeof runCleanup>[0],
        log as unknown as Parameters<typeof runCleanup>[1],
      );

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.kind).toBe('error');
      expect(event.payload).toMatchObject({
        err: 'PrismaClientKnownRequestError',
        code,
        hint: expect.stringContaining('DB_CONNECT_TIMEOUT_MS'),
      });
      expect(JSON.stringify(event.payload)).not.toContain(errMessage);
    }
  });

  it('logs stats on success', async () => {
    const events: Array<{ kind: 'info' | 'error'; payload: unknown; msg: string }> = [];
    const log: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void } = {
      info: (obj: unknown, msg: string) => events.push({ kind: 'info', payload: obj, msg }),
      error: (obj: unknown, msg: string) => events.push({ kind: 'error', payload: obj, msg }),
    };
    const service: {
      cleanup: () => Promise<{ expired: number; tombstones: number; inactivePersistent: number }>;
      stats: () => Promise<{
        active: number;
        activePayloadBytes: number;
        expiredPending: number;
        tombstones: number;
      }>;
    } = {
      cleanup: async () => ({ expired: 1, tombstones: 2, inactivePersistent: 3 }),
      stats: async () => ({ active: 4, activePayloadBytes: 5, expiredPending: 6, tombstones: 7 }),
    };

    const result = await runCleanup(
      service as unknown as Parameters<typeof runCleanup>[0],
      log as unknown as Parameters<typeof runCleanup>[1],
    );

    expect(result).toEqual({ expired: 1, tombstones: 2, inactivePersistent: 3 });
    expect(events).toHaveLength(1);
    const infoEvent = events[0]!;
    expect(infoEvent.kind).toBe('info');
    expect(infoEvent.payload).toMatchObject({
      expired: 1,
      inactivePersistent: 3,
      active: 4,
      activePayloadBytes: 5,
      expiredPending: 6,
    });
    expect((infoEvent.payload as { tombstones: number }).tombstones).toBe(7);
    expect(infoEvent.msg).toBe('cleanup complete');
  });
});
