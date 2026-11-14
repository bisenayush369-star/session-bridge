/* global process, console, fetch */
/* eslint no-console: ["error", { "allow": ["log", "error", "warn"] }] */
import assert from 'node:assert/strict';

const baseUrl = process.argv[2] || 'http://127.0.0.1:3000';
const headers = {
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json',
};

const sample = () => ({
  project: { name: 'Session Bridge smoke', stack: ['Node.js', 'TypeScript', 'PostgreSQL'] },
  objective: 'Smoke test the API and MCP route',
  decisions: ['Verify the HTTP stack works'],
  completed: ['Build and tests pass'],
  current_state: ['Server is running locally'],
  next_action: 'Confirm the smoke test succeeded',
  constraints: ['Keep the test focused'],
  retention: '30d',
});

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, message });
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { res, json };
}

await check('health', async () => {
  const { res, json } = await fetchJson(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(json, { status: 'ok' });
});

let handoffId = '';
let token = '';

await check('create handoff', async () => {
  const { res, json } = await fetchJson(`${baseUrl}/v1/handoffs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(sample()),
  });
  assert.equal(res.status, 201, `status=${res.status} body=${JSON.stringify(json)}`);
  assert.match(json.handoff_id, /^hs_/);
  assert.match(json.retrieval_token, /^sbt_/);
  handoffId = json.handoff_id;
  token = json.retrieval_token;
});

await check('create response includes no-store headers', async () => {
  const { res } = await fetchJson(`${baseUrl}/v1/handoffs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(sample()),
  });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

await check('wrong bearer token is hidden as 404', async () => {
  const wrongBearer = `sbt_${'B'.repeat(43)}`;
  const { res, json } = await fetchJson(`${baseUrl}/v1/handoffs/${handoffId}`, {
    headers: { Authorization: `Bearer ${wrongBearer}` },
  });
  assert.equal(res.status, 404);
  assert.equal(json.error.code, 'not_found');
});

await check('load handoff with bearer token', async () => {
  const { res, json } = await fetchJson(`${baseUrl}/v1/handoffs/${handoffId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  assert.equal(json.memory.objective, 'Smoke test the API and MCP route');
});

await check('resume handoff', async () => {
  const { res, json } = await fetchJson(`${baseUrl}/v1/handoffs/${handoffId}/resume`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'text' }),
  });
  assert.equal(res.status, 200);
  assert.match(json.text, /Smoke test the API and MCP route/);
});

await check('delete handoff', async () => {
  const { res, json } = await fetchJson(`${baseUrl}/v1/handoffs/${handoffId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  assert.equal(json.status, 'deleted');
});

await check('deleted handoff is hidden as 404', async () => {
  const { res, json } = await fetchJson(`${baseUrl}/v1/handoffs/${handoffId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 404);
  assert.equal(json.error.code, 'not_found');
});

await check('unknown route 404', async () => {
  const { res, json } = await fetchJson(`${baseUrl}/nope`);
  assert.equal(res.status, 404);
  assert.equal(json.error.code, 'not_found');
});

await check('invalid content type 415', async () => {
  const { res, json } = await fetchJson(`${baseUrl}/v1/handoffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'plain text',
  });
  assert.equal(res.status, 415);
  assert.equal(json.error.code, 'unsupported_media_type');
});

await check('mcp tools list', async () => {
  const { res, json } = await fetchJson(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(json.result.tools));
});

await check('mcp prompts list', async () => {
  const { res, json } = await fetchJson(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'prompts/list', params: {} }),
  });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(json.result.prompts));
});

await check('mcp create_handoff tool', async () => {
  const { res, json } = await fetchJson(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'create_handoff', arguments: sample() },
    }),
  });
  assert.equal(res.status, 200);
  assert.match(json.result.content[0].text, /hs_/);
});

await check('mcp resume_handoff tool', async () => {
  const create = await fetchJson(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'create_handoff', arguments: sample() },
    }),
  });
  const text = create.json.result.content[0].text;
  const id = /(hs_[A-Za-z0-9_-]{16})/.exec(text)?.[1] ?? '';
  const tokenValue = /(sbt_[A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? '';
  assert.notEqual(id, '');
  assert.notEqual(tokenValue, '');
  const { res, json: resumed } = await fetchJson(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'resume_handoff', arguments: { handoff_id: id, retrieval_token: tokenValue } },
    }),
  });
  assert.equal(res.status, 200);
  assert.match(resumed.result.content[0].text, /Smoke test the API and MCP route/);
});

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`Smoke test failed: ${failed.length} checks failed`);
  for (const item of failed) {
    console.error(`- ${item.name}: ${item.message}`);
  }
  process.exit(1);
}

console.log(`${results.length}/14 checks passed against ${baseUrl}`);
