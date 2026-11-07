import { HANDOFF_ID_PATTERN } from '@session-bridge/shared';
import { AppError, errors } from '../errors.js';
import type { Hooks } from '../services/handoff-service.js';
import type { Operation, RequestGuard } from './guard.js';

/**
 * Authorization flow shared by the REST routes and the hosted MCP endpoint:
 * id format -> invalid-attempt block -> token present -> operation (the service verifies the token) ->
 * failure accounting. `token` is null when the caller supplied none or a malformed one.
 */
export async function runAuthed<T>(
  guard: RequestGuard,
  ip: string,
  id: string,
  token: string | null,
  op: Operation,
  run: (token: string, hooks: Hooks) => Promise<T>,
): Promise<T> {
  if (!HANDOFF_ID_PATTERN.test(id)) throw errors.notFound();
  guard.assertNotBlocked(ip, id);
  if (!token) {
    guard.recordFailure(ip, id);
    throw errors.unauthorized();
  }
  try {
    return await run(token, { afterAuth: () => guard.checkAuthenticated(ip, id, op) });
  } catch (e) {
    if (e instanceof AppError && e.status === 404) guard.recordFailure(ip, id);
    throw e;
  }
}
