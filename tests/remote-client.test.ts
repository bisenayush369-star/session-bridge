import { describe, expect, it } from 'vitest';
import { RequestGuard } from '../apps/api/src/middleware/guard.js';
import type { CreateInput } from '../apps/api/src/services/handoff-service.js';
import { createInProcessClient, type CreateParser } from '../apps/api/src/services/remote-client.js';
import { disabledTokenStore } from '../packages/mcp-server/src/token-store.js';
import { createHandoffTool, deleteHandoffTool, resumeHandoffTool, type ToolDeps } from '../packages/mcp-server/src/tools.js';
import { makeService, sampleInput } from './helpers.js';

const parseCreate: CreateParser = (body) =>
  typeof body === 'object' && body !== null && 'objective' in body
    ? { ok: true, data: body as CreateInput }
    : { ok: false, message: 'objective: Required' };

const rate = {
  createPerMin: 10,
  globalCreatePerMin: 100,
  readPerMin: 60,
  resumePerMin: 60,
  deletePerMin: 60,
  ipPerMin: 1000,
  mcpIpPerMin: 1000,
  mcpCreatePerMin: 3,
  invalidPerWindow: 3,
  invalidIpPerWindow: 50,
  invalidWindowSeconds: 900,
};

function setup(ip = '34.0.0.1') {
  const { service, clock } = makeService();
  const guard = new RequestGuard(rate, clock);
  const deps: ToolDeps = { client: createInProcessClient({ service, guard, ip, parseCreate }), store: disabledTokenStore, revealToken: true };
  return { deps, service, guard };
}
const first = (r: { content: Array<{ text: string }> }): string => r.content[0]?.text ?? '';
const idOf = (t: string): string => /(hs_[A-Za-z0-9_-]{16})/.exec(t)?.[1] ?? '';
const tokenOf = (t: string): string => /(sbt_[A-Za-z0-9_-]{43})/.exec(t)?.[1] ?? '';

describe('hosted MCP path (tools -> in-process client -> service), as claude.ai would call it', () => {
  it('saves, resumes and deletes a handoff end to end', async () => {
    const { deps } = setup();
    const saved = await createHandoffTool(deps, sampleInput() as never);
    expect(saved.isError).toBeUndefined();
    const id = idOf(first(saved));
    const token = tokenOf(first(saved));
    expect(id).not.toBe('');
    expect(token).not.toBe('');
    expect(first(saved)).toContain('Token NOT saved locally');

    const resumed = await resumeHandoffTool(deps, { handoff_id: id, retrieval_token: token });
    expect(resumed.isError).toBeUndefined();
    expect(first(resumed)).toContain('Fix authentication');
    expect(first(resumed)).toContain('Inspect the auth callback');

    expect((await deleteHandoffTool(deps, { handoff_id: id, retrieval_token: token })).isError).toBeUndefined();
    const after = await resumeHandoffTool(deps, { handoff_id: id, retrieval_token: token });
    expect(after.isError).toBe(true);
    expect(first(after)).toContain('not_found');
  });

  it('needs the token: the id alone is refused before any request is made', async () => {
    const { deps } = setup();
    const id = idOf(first(await createHandoffTool(deps, sampleInput() as never)));
    const r = await resumeHandoffTool(deps, { handoff_id: id });
    expect(r.isError).toBe(true);
    expect(first(r)).toContain('cannot authorize');
  });

  it('shows the same error for a wrong token and an unknown id, and throttles repeated guesses per IP', async () => {
    const { deps } = setup('evil-ip');
    const id = idOf(first(await createHandoffTool(deps, sampleInput() as never)));
    const wrong = `sbt_${'Z'.repeat(43)}`;
    const a = await resumeHandoffTool(deps, { handoff_id: id, retrieval_token: wrong });
    const b = await resumeHandoffTool(deps, { handoff_id: 'hs_ZZZZZZZZZZZZZZZZ', retrieval_token: wrong });
    expect(first(a)).toBe(first(b));
    await resumeHandoffTool(deps, { handoff_id: id, retrieval_token: wrong }); // 2nd failure for this id
    await resumeHandoffTool(deps, { handoff_id: id, retrieval_token: wrong }); // 3rd: the limit is now reached
    const blocked = await resumeHandoffTool(deps, { handoff_id: id, retrieval_token: wrong });
    expect(first(blocked)).toContain('rate_limited');
  });

  it('applies the hosted-channel creation limit and reports validation errors as tool errors', async () => {
    const { deps } = setup();
    for (let i = 0; i < 3; i += 1) expect((await createHandoffTool(deps, sampleInput() as never)).isError).toBeUndefined();
    const limited = await createHandoffTool(deps, sampleInput() as never);
    expect(limited.isError).toBe(true);
    expect(first(limited)).toContain('rate_limited');
    const invalid = await createHandoffTool(setup('9.9.9.9').deps, { project: { name: 'x' } } as never);
    expect(invalid.isError).toBe(true);
    expect(first(invalid)).toContain('validation_failed');
  });
});
