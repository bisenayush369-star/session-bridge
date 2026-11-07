import type { ApiClient } from '@session-bridge/mcp-server';
import { errors } from '../errors.js';
import { runAuthed } from '../middleware/authed.js';
import type { RequestGuard } from '../middleware/guard.js';
import type { CreateInput, HandoffService } from './handoff-service.js';

export type CreateParser = (
  body: unknown,
) => { ok: true; data: CreateInput } | { ok: false; message: string };

const isFormat = (v: unknown): v is 'text' | 'json' | 'both' => v === 'text' || v === 'json' || v === 'both';

/**
 * ApiClient for the hosted MCP endpoint: the same guard and service rules as the REST routes, called in-process
 * (no HTTP hop). Failures are AppError (status/code/message), which the MCP tool layer turns into tool errors.
 */
export function createInProcessClient(opts: {
  service: HandoffService;
  guard: RequestGuard;
  ip: string;
  parseCreate: CreateParser;
}): ApiClient {
  const { service, guard, ip, parseCreate } = opts;
  return {
    async createHandoff(body) {
      guard.checkCreate(ip, 'mcp');
      const parsed = parseCreate(body);
      if (!parsed.ok) throw errors.validation(parsed.message);
      return service.create(parsed.data);
    },
    resume: (id, token, body) =>
      runAuthed(guard, ip, id, token, 'resume', (t, hooks) =>
        service.resume(
          id,
          t,
          {
            ...(body.max_tokens !== undefined ? { maxTokens: body.max_tokens } : {}),
            ...(isFormat(body.format) ? { format: body.format } : {}),
          },
          hooks,
        ),
      ),
    deleteHandoff: (id, token) =>
      runAuthed(guard, ip, id, token, 'delete', (t, hooks) => service.remove(id, t, hooks)),
  };
}
