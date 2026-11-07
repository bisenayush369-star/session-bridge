import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodError } from 'zod';
import { createHandoffSchema, resumeRequestSchema } from '@session-bridge/shared/schema';
import type { AppDeps } from '../app.js';
import { AppError, errors } from '../errors.js';
import { runAuthed } from '../middleware/authed.js';
import type { Operation } from '../middleware/guard.js';
import { parseBearer } from '../services/credentials.js';
import type { Hooks } from '../services/handoff-service.js';

type IdRequest = FastifyRequest<{ Params: { id: string } }>;

function validationError(err: ZodError): AppError {
  const details = err.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }));
  return errors.validation('Request validation failed.', details);
}

function authed<T>(
  deps: AppDeps,
  req: IdRequest,
  op: Operation,
  run: (id: string, token: string, hooks: Hooks) => Promise<T>,
): Promise<T> {
  const id = req.params.id;
  return runAuthed(deps.guard, req.ip, id, parseBearer(req.headers.authorization), op, (token, hooks) =>
    run(id, token, hooks),
  );
}

export function registerHandoffRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/v1/handoffs', async (req, reply) => {
    deps.guard.checkCreate(req.ip);
    const parsed = createHandoffSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    const result = await deps.service.create(parsed.data);
    return reply.code(201).send(result);
  });

  app.get<{ Params: { id: string } }>('/v1/handoffs/:id', (req) =>
    authed(deps, req, 'read', (id, token, hooks) => deps.service.get(id, token, hooks)),
  );

  app.post<{ Params: { id: string } }>('/v1/handoffs/:id/resume', async (req) => {
    const parsed = resumeRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw validationError(parsed.error);
    const { max_tokens: maxTokens, format } = parsed.data;
    return authed(deps, req, 'resume', (id, token, hooks) =>
      deps.service.resume(id, token, { ...(maxTokens !== undefined ? { maxTokens } : {}), format }, hooks),
    );
  });

  app.delete<{ Params: { id: string } }>('/v1/handoffs/:id', (req) =>
    authed(deps, req, 'delete', (id, token, hooks) => deps.service.remove(id, token, hooks)),
  );
}
