import { describe, expect, it } from 'vitest';
import { errors } from '../apps/api/src/errors.js';
import { runAuthed } from '../apps/api/src/middleware/authed.js';
import { RequestGuard } from '../apps/api/src/middleware/guard.js';
import { FakeClock, rejection } from './helpers.js';

const rate = {
  createPerMin: 10,
  globalCreatePerMin: 25,
  readPerMin: 2,
  resumePerMin: 2,
  deletePerMin: 2,
  ipPerMin: 100,
  mcpIpPerMin: 100,
  mcpCreatePerMin: 10,
  invalidPerWindow: 3,
  invalidIpPerWindow: 50,
  invalidWindowSeconds: 900,
};
const ID = 'hs_AAAAAAAAAAAAAAAA';
const TOKEN = `sbt_${'A'.repeat(43)}`;
const make = () => {
  const clock = new FakeClock();
  return { clock, guard: new RequestGuard(rate, clock) };
};
const ok = async () => 'ok';

describe('runAuthed', () => {
  it('answers malformed ids with 404 and never counts them as credential failures', async () => {
    const { guard } = make();
    for (let i = 0; i < 10; i += 1)
      expect((await rejection(runAuthed(guard, 'ip', 'nope', TOKEN, 'read', ok))).status).toBe(404);
    expect(await runAuthed(guard, 'ip', ID, TOKEN, 'read', ok)).toBe('ok');
  });

  it('answers a missing token with 401, counts it, and blocks that IP after repeated failures', async () => {
    const { guard } = make();
    for (let i = 0; i < 3; i += 1)
      expect((await rejection(runAuthed(guard, 'evil', ID, null, 'read', ok))).status).toBe(401);
    expect((await rejection(runAuthed(guard, 'evil', ID, null, 'read', ok))).status).toBe(429);
    expect(await runAuthed(guard, 'other-ip', ID, TOKEN, 'read', ok)).toBe('ok');
  });

  it('counts only 404s from the operation as failures', async () => {
    const { guard } = make();
    for (let i = 0; i < 5; i += 1) {
      const e = await rejection(
        runAuthed(guard, 'ip', ID, TOKEN, 'read', async () => {
          throw errors.gone('expired');
        }),
      );
      expect(e.status).toBe(410);
    }
    for (let i = 0; i < 3; i += 1) {
      expect(
        (
          await rejection(
            runAuthed(guard, 'ip', ID, TOKEN, 'read', async () => {
              throw errors.notFound();
            }),
          )
        ).status,
      ).toBe(404);
    }
    expect((await rejection(runAuthed(guard, 'ip', ID, TOKEN, 'read', ok))).status).toBe(429);
  });

  it('applies per-handoff operation limits through afterAuth, only for authorized work', async () => {
    const { guard } = make();
    const op = async (_t: string, hooks: { afterAuth?: () => void }) => {
      hooks.afterAuth?.();
      return 'ok';
    };
    expect(await runAuthed(guard, 'ip', ID, TOKEN, 'read', op)).toBe('ok');
    expect(await runAuthed(guard, 'ip', ID, TOKEN, 'read', op)).toBe('ok');
    expect((await rejection(runAuthed(guard, 'ip', ID, TOKEN, 'read', op))).status).toBe(429);
    // a 429 raised by the limiter is not a credential failure
    expect(await runAuthed(guard, 'ip', 'hs_BBBBBBBBBBBBBBBB', TOKEN, 'read', op)).toBe('ok');
  });
});
