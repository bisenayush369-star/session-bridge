import type { FastifyInstance } from 'fastify';
import type { HandoffRepository } from '../services/repository.js';

/** Minimal liveness/readiness probe. Exposes no configuration, versions or infrastructure detail. */
export function registerHealthRoute(app: FastifyInstance, repo: HandoffRepository): void {
  app.get('/health', async (_req, reply) => {
    try {
      await Promise.race([
        repo.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2_000).unref()),
      ]);
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}
