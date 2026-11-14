import type { FastifyInstance } from 'fastify';
import type { HandoffRepository } from '../services/repository.js';

/** Minimal liveness/readiness probe. Exposes no configuration, versions or infrastructure detail. */
export function registerHealthRoute(app: FastifyInstance, repo: HandoffRepository, timeoutMs = 5_000): void {
  app.get('/health', async (_req, reply) => {
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        timer.unref?.();
        void Promise.resolve(repo.ping())
          .then(() => {
            clearTimeout(timer);
            resolve();
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}
