import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import { AppError, errors } from './errors.js';
import type { RequestGuard } from './middleware/guard.js';
import { registerHandoffRoutes } from './routes/handoffs.js';
import { registerHealthRoute } from './routes/health.js';
import { registerMcpRoute } from './routes/mcp.js';
import type { HandoffService } from './services/handoff-service.js';
import type { HandoffRepository } from './services/repository.js';

export interface AppDeps {
  config: Config;
  service: HandoffService;
  guard: RequestGuard;
  repo: HandoffRepository;
}

type HttpError = Error & { statusCode?: number };

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config } = deps;
  const app = Fastify({
    logger:
      config.env === 'test'
        ? false
        : {
            level: config.logLevel,
            // Bodies are never logged. Only method, path (no query string) and client address.
            redact: { paths: ['req.headers.authorization'], censor: '[REDACTED]' },
            serializers: {
              req: (req: FastifyRequest) => ({ method: req.method, url: req.url.split('?')[0], ip: req.ip }),
            },
          },
    bodyLimit: config.maxBodyBytes,
    trustProxy: config.trustProxy,
    connectionTimeout: 30_000,
    requestTimeout: 15_000,
    keepAliveTimeout: 5_000,
    maxParamLength: 64,
  });

  const isHealth = (req: FastifyRequest): boolean => req.url === '/health' || req.url.startsWith('/health?');
  let inFlight = 0;

  app.addHook('onRequest', async (request, reply) => {
    if (inFlight >= config.maxConcurrentRequests) throw errors.busy();
    inFlight += 1;
    reply.raw.once('close', () => {
      inFlight -= 1;
    });
    if (isHealth(request)) return;
    if (config.requireHttps && request.protocol !== 'https') throw errors.httpsRequired();
    deps.guard.checkIp(request.ip, request.url.startsWith('/mcp') ? 'mcp' : 'api');
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    if (config.requireHttps) reply.header('Strict-Transport-Security', 'max-age=31536000');
    return payload;
  });

  app.setErrorHandler((err: HttpError, request, reply) => {
    if (err instanceof AppError) {
      if (err.extra.retryAfterSeconds) reply.header('Retry-After', String(err.extra.retryAfterSeconds));
      return reply.code(err.status).send({
        error: { code: err.code, message: err.message, ...(err.extra.details ? { details: err.extra.details } : {}) },
      });
    }
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) {
      // Log only the error type: library messages (e.g. ORM validation errors) can echo request data.
      request.log.error({ errType: err.name }, 'unhandled error');
      return reply.code(500).send({ error: { code: 'internal_error', message: 'Internal server error.' } });
    }
    const [code, message] =
      status === 413
        ? ['payload_too_large', 'Request body is too large.']
        : status === 415
          ? ['unsupported_media_type', 'Content-Type must be application/json.']
          : ['bad_request', 'Malformed request.'];
    return reply.code(status).send({ error: { code, message } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Route not found.' } }),
  );

  registerHealthRoute(app, deps.repo);
  registerHandoffRoutes(app, deps);
  registerMcpRoute(app, deps);
  return app;
}
