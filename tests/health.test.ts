import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerHealthRoute } from '../apps/api/src/routes/health.js';
import type { HandoffRepository } from '../apps/api/src/services/repository.js';

const makeRepo = (ping: () => Promise<void>): HandoffRepository =>
  ({
    create: async () => {},
    findByPublicId: async () => null,
    touch: async () => {},
    markDeleted: async () => false,
    markRevoked: async () => false,
    purge: async () => ({ expired: 0, tombstones: 0, inactivePersistent: 0 }),
    stats: async () => ({ active: 0, activePayloadBytes: 0, expiredPending: 0, tombstones: 0 }),
    ping,
  }) as HandoffRepository;

describe('registerHealthRoute', () => {
  it('returns ok when ping resolves', async () => {
    const app = Fastify();
    registerHealthRoute(
      app,
      makeRepo(async () => {}),
      50,
    );
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('returns 503 when ping rejects', async () => {
    const app = Fastify();
    registerHealthRoute(
      app,
      makeRepo(async () => {
        throw new Error('db down');
      }),
      50,
    );
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable' });
    await app.close();
  });

  it('returns 503 when ping is slower than the timeout', async () => {
    const app = Fastify();
    registerHealthRoute(
      app,
      makeRepo(
        async () =>
          new Promise((resolve) => {
            setTimeout(resolve, 30);
          }),
      ),
      10,
    );
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable' });
    await app.close();
  });

  it('returns ok when the timeout is raised', async () => {
    const app = Fastify();
    registerHealthRoute(
      app,
      makeRepo(
        async () =>
          new Promise((resolve) => {
            setTimeout(resolve, 20);
          }),
      ),
      100,
    );
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
