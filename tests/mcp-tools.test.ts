import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeBaseUrl, SessionBridgeApiError, type ApiClient, type CreateResponse } from '../packages/mcp-server/src/client.js';
import { disabledTokenStore, FileTokenStore } from '../packages/mcp-server/src/token-store.js';
import {
  createHandoffTool,
  deleteHandoffTool,
  resumeHandoffTool,
  searchArchiveTool,
  type ToolDeps,
} from '../packages/mcp-server/src/tools.js';
import { sampleInput, thrown } from './helpers.js';

const ID = 'hs_AAAAAAAAAAAAAAAA';
const TOKEN = `sbt_${'A'.repeat(43)}`;

function setup(over: Partial<ApiClient> = {}, revealToken = true, enabled = true) {
  const sent: unknown[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'sb-mcp-'));
  const path = join(dir, 'nested', 'tokens.json');
  const store = enabled ? new FileTokenStore(path, () => Date.parse('2026-11-03T00:00:00Z')) : disabledTokenStore;
  const created: CreateResponse = {
    handoff_id: ID,
    retrieval_token: TOKEN,
    expires_at: '2026-12-03T00:00:00.000Z',
    status: 'active',
    retention: '30d',
    payload_bytes: 321,
    truncated: false,
    warnings: [],
  };
  const client: ApiClient = {
    createHandoff: async (body) => {
      sent.push(body);
      return created;
    },
    resume: async (id, token, body) => {
      sent.push({ id, token, body });
      return { handoff_id: id, text: '# Session handoff\nNext action: go', approx_tokens: 9, token_estimate: 'approximate', truncated: false, omitted: {}, archive: { available: false, reference: null } };
    },
    deleteHandoff: async (id) => ({ handoff_id: id, status: 'deleted' }),
    ...over,
  };
  const deps: ToolDeps = { client, store, revealToken };
  return { deps, sent, store, path };
}

describe('create_handoff', () => {
  it('redacts before sending, saves the token locally with 0600 permissions and reports success', async () => {
    const { deps, sent, store, path } = setup();
    const r = await createHandoffTool(deps, sampleInput({ next_action: 'use key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' }) as never);
    expect(r.isError).toBeUndefined();
    expect(JSON.stringify(sent[0])).not.toContain('sk-ant');
    expect(r.content[0]?.text).toContain(ID);
    expect(r.content[0]?.text).toContain(TOKEN);
    expect(r.content[0]?.text).toContain('redacted client-side');
    expect(store.get(ID)).toBe(TOKEN);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('can withhold the token from the conversation while still storing it', async () => {
    const { deps, store } = setup({}, false);
    const r = await createHandoffTool(deps, sampleInput() as never);
    expect(r.content[0]?.text).not.toContain(TOKEN);
    expect(store.get(ID)).toBe(TOKEN);
  });

  it('maps API errors without leaking anything sensitive', async () => {
    const { deps } = setup({ createHandoff: async () => { throw new SessionBridgeApiError(429, 'rate_limited', 'Too many requests. Retry later.'); } });
    const r = await createHandoffTool(deps, sampleInput() as never);
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('rate_limited');
  });

  it('does not claim success when the call fails unexpectedly', async () => {
    const { deps } = setup({ createHandoff: async () => { throw new Error('boom with sbt_secret'); } });
    const r = await createHandoffTool(deps, sampleInput() as never);
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).not.toContain('boom');
    expect(r.content[0]?.text).not.toContain('Handoff saved');
  });
});

describe('resume_handoff / delete_handoff / search_archive', () => {
  it('falls back to the locally stored token', async () => {
    const { deps, sent, store } = setup();
    store.save(ID, TOKEN, null);
    const r = await resumeHandoffTool(deps, { handoff_id: ID, max_tokens: 1000 });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]?.text).toContain('Next action: go');
    expect(sent[0]).toEqual({ id: ID, token: TOKEN, body: { max_tokens: 1000 } });
  });

  it('prefers an explicit token and refuses to proceed without one (the id alone is not enough)', async () => {
    const { deps, sent } = setup({}, true, false);
    const none = await resumeHandoffTool(deps, { handoff_id: ID });
    expect(none.isError).toBe(true);
    expect(sent).toHaveLength(0);
    await resumeHandoffTool(deps, { handoff_id: ID, retrieval_token: TOKEN });
    expect(sent).toHaveLength(1);
  });

  it('surfaces not-found/expired errors and flags truncation', async () => {
    const failing = setup({ resume: async () => { throw new SessionBridgeApiError(410, 'expired', 'This handoff has expired.'); } });
    const r = await resumeHandoffTool(failing.deps, { handoff_id: ID, retrieval_token: TOKEN });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('expired');
    const trunc = setup({ resume: async (id) => ({ handoff_id: id, text: 'ctx', approx_tokens: 1, token_estimate: 'approximate', truncated: true, omitted: { completed: 3 }, archive: { available: false, reference: null } }) });
    const t = await resumeHandoffTool(trunc.deps, { handoff_id: ID, retrieval_token: TOKEN });
    expect(t.content[0]?.text).toContain('TRUNCATED');
  });

  it('deletes and forgets the local token', async () => {
    const { deps, store } = setup();
    store.save(ID, TOKEN, null);
    const r = await deleteHandoffTool(deps, { handoff_id: ID });
    expect(r.content[0]?.text).toContain('deleted');
    expect(store.get(ID)).toBeUndefined();
  });

  it('search_archive is an explicit unsupported operation', () => {
    const r = searchArchiveTool();
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('unsupported_operation');
  });
});

describe('client safety', () => {
  it('only allows plain http for loopback', () => {
    expect(assertSafeBaseUrl('https://api.example.com').protocol).toBe('https:');
    expect(assertSafeBaseUrl('http://localhost:3000').hostname).toBe('localhost');
    expect(thrown(() => assertSafeBaseUrl('http://api.example.com')).message).toContain('https');
  });

  it('expires stored tokens', () => {
    let now = Date.parse('2026-11-03T00:00:00Z');
    const dir = mkdtempSync(join(tmpdir(), 'sb-mcp-'));
    const store = new FileTokenStore(join(dir, 't.json'), () => now);
    store.save(ID, TOKEN, '2026-11-04T00:00:00.000Z');
    expect(store.get(ID)).toBe(TOKEN);
    now = Date.parse('2026-11-04T00:00:01Z');
    expect(store.get(ID)).toBeUndefined();
  });
});
