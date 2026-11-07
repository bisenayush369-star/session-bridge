import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import { RequestGuard } from '../apps/api/src/middleware/guard.js';
import { HandoffService } from '../apps/api/src/services/handoff-service.js';
import { InMemoryHandoffRepository } from '../apps/api/src/services/memory-repository.js';
import { sampleInput, TEST_PEPPER } from './helpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function makeApp(env: Record<string, string> = {}) {
  const config = loadConfig({ NODE_ENV: 'test', TOKEN_PEPPER: TEST_PEPPER, ...env });
  const repo = new InMemoryHandoffRepository();
  const service = new HandoffService({ repo, config });
  const app = buildApp({ config, service, guard: new RequestGuard(config.rate), repo });
  apps.push(app);
  return app;
}

async function create(app: FastifyInstance, remoteAddress = '10.0.0.1') {
  const res = await app.inject({ method: 'POST', url: '/v1/handoffs', payload: sampleInput(), remoteAddress });
  return { res, ...(res.json() as { handoff_id: string; retrieval_token: string }) };
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('POST /v1/handoffs', () => {
  it('creates a handoff and returns id, token, expiry and no-store headers', async () => {
    const app = makeApp();
    const { res, handoff_id, retrieval_token } = await create(app);
    expect(res.statusCode).toBe(201);
    expect(handoff_id).toMatch(/^hs_/);
    expect(retrieval_token).toMatch(/^sbt_/);
    expect(res.json().status).toBe('active');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('validates input (400), unknown keys (400), media type (415) and body size (413)', async () => {
    const app = makeApp({ MAX_BODY_BYTES: '2048' });
    const bad = await app.inject({ method: 'POST', url: '/v1/handoffs', payload: { objective: 'x' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('validation_failed');
    const extra = await app.inject({ method: 'POST', url: '/v1/handoffs', payload: { ...sampleInput(), nope: 1 } });
    expect(extra.statusCode).toBe(400);
    const text = await app.inject({ method: 'POST', url: '/v1/handoffs', headers: { 'content-type': 'text/plain' }, payload: 'hi' });
    expect(text.statusCode).toBe(415);
    const big = await app.inject({ method: 'POST', url: '/v1/handoffs', payload: sampleInput({ objective: 'x'.repeat(1_900), next_action: 'y'.repeat(1_900) }) });
    expect(big.statusCode).toBe(413);
    expect(big.json().error.code).toBe('payload_too_large');
  });

  it('rate limits creation with 429 and Retry-After', async () => {
    const app = makeApp({ RATE_LIMIT_CREATE_PER_MIN: '2' });
    await create(app);
    await create(app);
    const { res } = await create(app);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect((await create(app, '10.0.0.2')).res.statusCode).toBe(201);
  });
});

describe('retrieval, resume and deletion', () => {
  it('requires the bearer token (header only) and hides existence', async () => {
    const app = makeApp();
    const { handoff_id, retrieval_token } = await create(app);
    expect((await app.inject({ method: 'GET', url: `/v1/handoffs/${handoff_id}` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/v1/handoffs/${handoff_id}?token=${retrieval_token}` })).statusCode).toBe(401);
    const wrong = await app.inject({ method: 'GET', url: `/v1/handoffs/${handoff_id}`, headers: auth(`sbt_${'B'.repeat(43)}`) });
    const unknown = await app.inject({ method: 'GET', url: '/v1/handoffs/hs_ZZZZZZZZZZZZZZZZ', headers: auth(retrieval_token) });
    expect(wrong.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(wrong.json()).toEqual(unknown.json());
    const ok = await app.inject({ method: 'GET', url: `/v1/handoffs/${handoff_id}`, headers: auth(retrieval_token) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().memory.objective).toBe('Fix authentication');
  });

  it('resumes in text and json formats and validates the body', async () => {
    const app = makeApp();
    const { handoff_id, retrieval_token } = await create(app);
    const text = await app.inject({ method: 'POST', url: `/v1/handoffs/${handoff_id}/resume`, headers: auth(retrieval_token), payload: {} });
    expect(text.statusCode).toBe(200);
    expect(text.json().text).toContain('Inspect the auth callback');
    const json = await app.inject({ method: 'POST', url: `/v1/handoffs/${handoff_id}/resume`, headers: auth(retrieval_token), payload: { format: 'json' } });
    expect(json.json().package.objective).toBe('Fix authentication');
    expect(json.json().text).toBeUndefined();
    const bad = await app.inject({ method: 'POST', url: `/v1/handoffs/${handoff_id}/resume`, headers: auth(retrieval_token), payload: { max_tokens: 5 } });
    expect(bad.statusCode).toBe(400);
  });

  it('deletes idempotently and then reports not found', async () => {
    const app = makeApp();
    const { handoff_id, retrieval_token } = await create(app);
    for (let i = 0; i < 2; i += 1) {
      const del = await app.inject({ method: 'DELETE', url: `/v1/handoffs/${handoff_id}`, headers: auth(retrieval_token) });
      expect(del.statusCode).toBe(200);
      expect(del.json().status).toBe('deleted');
    }
    expect((await app.inject({ method: 'GET', url: `/v1/handoffs/${handoff_id}`, headers: auth(retrieval_token) })).statusCode).toBe(404);
  });

  it('throttles repeated invalid credentials per client address only', async () => {
    const app = makeApp({ RATE_LIMIT_INVALID_PER_WINDOW: '3' });
    const { handoff_id, retrieval_token } = await create(app);
    const bad = () => app.inject({ method: 'GET', url: `/v1/handoffs/${handoff_id}`, headers: auth(`sbt_${'C'.repeat(43)}`), remoteAddress: '6.6.6.6' });
    for (let i = 0; i < 3; i += 1) expect((await bad()).statusCode).toBe(404);
    const blocked = await bad();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    const legit = await app.inject({ method: 'GET', url: `/v1/handoffs/${handoff_id}`, headers: auth(retrieval_token), remoteAddress: '7.7.7.7' });
    expect(legit.statusCode).toBe(200);
  });
});

describe('hosted MCP endpoint (POST /mcp)', () => {
  const headers = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
  const rpc = (app: FastifyInstance, id: number, method: string, params: unknown, remoteAddress = '34.0.0.1') =>
    app.inject({ method: 'POST', url: '/mcp', headers, remoteAddress, payload: { jsonrpc: '2.0', id, method, params } });

  it('lists the tools and prompts without any server credential', async () => {
    const app = makeApp();
    const tools = (await rpc(app, 1, 'tools/list', {})).json();
    expect(tools.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(['create_handoff', 'delete_handoff', 'resume_handoff', 'search_archive']);
    const prompts = (await rpc(app, 2, 'prompts/list', {})).json();
    expect(prompts.result.prompts.map((p: { name: string }) => p.name).sort()).toEqual(['newsession', 'resume_session']);
  });

  it('saves and resumes through tools/call and keeps the REST API consistent', async () => {
    const app = makeApp();
    const created = (await rpc(app, 3, 'tools/call', { name: 'create_handoff', arguments: sampleInput() })).json();
    const text: string = created.result.content[0].text;
    const id = /(hs_[A-Za-z0-9_-]{16})/.exec(text)?.[1] ?? '';
    const token = /(sbt_[A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? '';
    expect(id).not.toBe('');
    const resumed = (await rpc(app, 4, 'tools/call', { name: 'resume_handoff', arguments: { handoff_id: id, retrieval_token: token } })).json();
    expect(resumed.result.content[0].text).toContain('Inspect the auth callback');
    const rest = await app.inject({ method: 'GET', url: `/v1/handoffs/${id}`, headers: auth(token) });
    expect(rest.statusCode).toBe(200);
  });

  it('requires the access key when MCP_ACCESS_TOKEN is set', async () => {
    const key = 'k'.repeat(32);
    const app = makeApp({ MCP_ACCESS_TOKEN: key });
    expect((await rpc(app, 1, 'tools/list', {})).statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/mcp', headers: { ...headers, 'x-session-bridge-key': key }, payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } });
    expect(ok.statusCode).toBe(200);
    // REST API is unaffected by the MCP key
    expect((await create(app)).res.statusCode).toBe(201);
  });

  it('rejects GET and DELETE with 405', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'GET', url: '/mcp' })).statusCode).toBe(405);
    expect((await app.inject({ method: 'DELETE', url: '/mcp' })).statusCode).toBe(405);
  });
});

describe('platform behaviour', () => {
  it('serves /health and JSON 404s for unknown routes', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok' });
    const nf = await app.inject({ method: 'GET', url: '/nope' });
    expect(nf.statusCode).toBe(404);
    expect(nf.json().error.code).toBe('not_found');
  });

  it('enforces https when required but exempts /health', async () => {
    const app = makeApp({ REQUIRE_HTTPS: 'true' });
    expect((await app.inject({ method: 'POST', url: '/v1/handoffs', payload: sampleInput() })).statusCode).toBe(426);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('rejects invalid environment configuration without echoing secrets', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', TOKEN_PEPPER: 'too-short' })).toThrow(/TOKEN_PEPPER/);
    expect(() => loadConfig({ NODE_ENV: 'production', TOKEN_PEPPER: 'CHANGE_ME_'.padEnd(40, 'x'), DATABASE_URL: 'postgresql://u:p@h/d' })).toThrow(/placeholder/);
  });
});
