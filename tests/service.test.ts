import { describe, expect, it } from 'vitest';
import { HANDOFF_ID_PATTERN, TOKEN_PATTERN } from '@session-bridge/shared';
import { generateRetrievalToken, hashToken } from '../apps/api/src/services/credentials.js';
import { bigInput, DAY, HOUR, makeService, rejection, sampleInput, TEST_PEPPER } from './helpers.js';

describe('HandoffService.create', () => {
  it('returns a token once and stores only its HMAC', async () => {
    const { service, repo } = makeService();
    const res = await service.create(sampleInput());
    expect(res.handoff_id).toMatch(HANDOFF_ID_PATTERN);
    expect(res.retrieval_token).toMatch(TOKEN_PATTERN);
    expect(res.status).toBe('active');
    const row = repo.rows.get(res.handoff_id);
    expect(row?.tokenHash).toBe(hashToken(res.retrieval_token, TEST_PEPPER));
    expect(JSON.stringify(row)).not.toContain(res.retrieval_token);
  });

  for (const [policy, ms] of [
    ['24h', DAY],
    ['30d', 30 * DAY],
    ['90d', 90 * DAY],
  ] as const) {
    it(`sets a UTC expiry for ${policy}`, async () => {
      const { service, clock } = makeService();
      const res = await service.create(sampleInput({ retention: policy }));
      expect(res.expires_at).toBe(new Date(clock.now() + ms).toISOString());
      expect(res.expires_at?.endsWith('Z')).toBe(true);
    });
  }

  it('defaults to 30d and only stores persistent when explicitly requested', async () => {
    const { service, repo } = makeService();
    const def = await service.create(sampleInput());
    expect(def.retention).toBe('30d');
    const pers = await service.create(sampleInput({ retention: 'persistent' }));
    expect(pers.expires_at).toBeNull();
    expect(repo.rows.get(pers.handoff_id)?.retention).toBe('persistent');
  });

  it('rejects client-chosen expiry values and disabled persistent retention', async () => {
    expect((await rejection(makeService().service.create(sampleInput({ retention: 'forever' })))).status).toBe(400);
    expect((await rejection(makeService({ allowPersistent: false }).service.create(sampleInput({ retention: 'persistent' })))).status).toBe(400);
  });

  it('redacts secrets before storing and says so', async () => {
    const { service, repo } = makeService();
    const res = await service.create(sampleInput({ next_action: 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 to call the API' }));
    expect(JSON.stringify(repo.rows.get(res.handoff_id)?.memory)).not.toContain('sk-ant');
    expect(res.warnings.join(' ')).toContain('redacted');
  });

  it('reduces oversize memory deterministically and reports it', async () => {
    const { service } = makeService({ memoryBudgetBytes: 4_000 });
    const res = await service.create(bigInput(50));
    expect(res.truncated).toBe(true);
    expect(res.payload_bytes).toBeLessThanOrEqual(4_000);
    expect(res.warnings.join(' ')).toContain('NOT preserved');
  });

  it('rejects memory whose critical fields are empty after cleaning', async () => {
    const { service } = makeService();
    expect((await rejection(service.create(sampleInput({ objective: '\u0001\u0002' })))).status).toBe(400);
  });

  it('retries on an id collision', async () => {
    const ids = ['hs_AAAAAAAAAAAAAAAA', 'hs_AAAAAAAAAAAAAAAA', 'hs_BBBBBBBBBBBBBBBB'];
    let i = 0;
    const { service } = makeService({}, () => ids[Math.min(i++, ids.length - 1)] ?? 'hs_AAAAAAAAAAAAAAAA');
    expect((await service.create(sampleInput())).handoff_id).toBe('hs_AAAAAAAAAAAAAAAA');
    expect((await service.create(sampleInput())).handoff_id).toBe('hs_BBBBBBBBBBBBBBBB');
  });

  it('handles 50 concurrent creations with unique ids and tokens, all retrievable', async () => {
    const { service } = makeService();
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => service.create(sampleInput({ objective: `Task ${i}` }))));
    expect(new Set(results.map((r) => r.handoff_id)).size).toBe(50);
    expect(new Set(results.map((r) => r.retrieval_token)).size).toBe(50);
    const fetched = await Promise.all(results.map((r) => service.get(r.handoff_id, r.retrieval_token)));
    fetched.forEach((f, i) => expect(f.memory.objective).toBe(`Task ${i}`));
  });
});

describe('HandoffService access control', () => {
  it('returns the memory only for the right token', async () => {
    const { service } = makeService();
    const { handoff_id: id, retrieval_token: token } = await service.create(sampleInput());
    const got = await service.get(id, token);
    expect(got.memory.objective).toBe('Fix authentication');
    expect(got.expires_at).not.toBeNull();
    expect((await rejection(service.get(id, generateRetrievalToken()))).status).toBe(404);
  });

  it('answers unknown ids and wrong tokens identically (no existence leak)', async () => {
    const { service } = makeService();
    const { handoff_id: id } = await service.create(sampleInput());
    const wrong = await rejection(service.get(id, generateRetrievalToken()));
    const unknown = await rejection(service.get('hs_ZZZZZZZZZZZZZZZZ', generateRetrievalToken()));
    const malformed = await rejection(service.get('nope', generateRetrievalToken()));
    for (const e of [unknown, malformed]) {
      expect(e.status).toBe(wrong.status);
      expect(e.code).toBe(wrong.code);
      expect(e.message).toBe(wrong.message);
    }
  });

  it('knowing only the id never authorizes anything', async () => {
    const { service } = makeService();
    const { handoff_id: id } = await service.create(sampleInput());
    for (const attempt of [id, '', 'sbt_', `sbt_${'A'.repeat(43)}`]) {
      expect((await rejection(service.get(id, attempt))).status).toBe(404);
      expect((await rejection(service.resume(id, attempt))).status).toBe(404);
      expect((await rejection(service.remove(id, attempt))).status).toBe(404);
    }
  });

  it('refuses expired handoffs (410) and removes them on cleanup (then 404)', async () => {
    const { service, clock } = makeService();
    const { handoff_id: id, retrieval_token: token } = await service.create(sampleInput({ retention: '24h' }));
    clock.advance(23 * HOUR);
    await service.get(id, token);
    clock.advance(HOUR);
    const gone = await rejection(service.get(id, token));
    expect(gone.status).toBe(410);
    expect(gone.code).toBe('expired');
    expect((await rejection(service.resume(id, token))).status).toBe(410);
    await service.cleanup();
    expect((await rejection(service.get(id, token))).status).toBe(404);
  });

  it('refuses revoked handoffs but still lets the holder delete them', async () => {
    const { service } = makeService();
    const { handoff_id: id, retrieval_token: token } = await service.create(sampleInput());
    expect(await service.revoke(id)).toBe(true);
    expect((await rejection(service.get(id, token))).code).toBe('revoked');
    expect((await rejection(service.resume(id, token))).status).toBe(410);
    expect((await service.remove(id, token)).status).toBe('deleted');
    expect(await service.revoke('hs_UNKNOWNUNKNOWN00')).toBe(false);
  });

  it('deletes: scrubs memory at once, is idempotent, then looks not-found', async () => {
    const { service, repo } = makeService();
    const { handoff_id: id, retrieval_token: token } = await service.create(sampleInput());
    expect((await service.remove(id, token)).status).toBe('deleted');
    const row = repo.rows.get(id);
    expect(row?.memory).toEqual({});
    expect(row?.payloadBytes).toBe(0);
    expect(row?.deletedAt).not.toBeNull();
    expect((await service.remove(id, token)).status).toBe('deleted');
    expect((await rejection(service.get(id, token))).status).toBe(404);
    expect((await rejection(service.remove(id, generateRetrievalToken()))).status).toBe(404);
  });

  it('runs the afterAuth hook only for authorized requests', async () => {
    const { service } = makeService();
    const { handoff_id: id, retrieval_token: token } = await service.create(sampleInput());
    let calls = 0;
    await rejection(service.get(id, generateRetrievalToken(), { afterAuth: () => void (calls += 1) }));
    expect(calls).toBe(0);
    await service.get(id, token, { afterAuth: () => void (calls += 1) });
    expect(calls).toBe(1);
  });
});

describe('HandoffService.resume', () => {
  it('returns continuation text with the saved context and no archive', async () => {
    const { service } = makeService();
    const { handoff_id: id, retrieval_token: token } = await service.create(sampleInput());
    const r = await service.resume(id, token);
    expect(r.text).toContain('Fix authentication');
    expect(r.text).toContain('Inspect the auth callback');
    expect(r.archive).toEqual({ available: false, reference: null });
    expect(r.package).toBeUndefined();
  });

  it('supports json and both formats and honours a token budget', async () => {
    const { service } = makeService();
    const { handoff_id: id, retrieval_token: token } = await service.create(bigInput(80));
    const json = await service.resume(id, token, { format: 'json' });
    expect(json.text).toBeUndefined();
    expect(json.package?.objective).toBe('Fix authentication');
    const both = await service.resume(id, token, { format: 'both', maxTokens: 1_500 });
    expect(both.text).toBeDefined();
    expect(both.truncated).toBe(true);
    expect(both.approx_tokens).toBeLessThanOrEqual(1_500);
  });
});

describe('HandoffService.cleanup', () => {
  it('removes expired handoffs and is idempotent', async () => {
    const { service, repo, clock } = makeService();
    const a = await service.create(sampleInput({ retention: '24h' }));
    const b = await service.create(sampleInput({ retention: '90d' }));
    clock.advance(25 * HOUR);
    expect(await service.cleanup()).toEqual({ expired: 1, tombstones: 0, inactivePersistent: 0 });
    expect(await service.cleanup()).toEqual({ expired: 0, tombstones: 0, inactivePersistent: 0 });
    expect(repo.rows.has(a.handoff_id)).toBe(false);
    expect(repo.rows.has(b.handoff_id)).toBe(true);
  });

  it('purges deleted tombstones after the grace period', async () => {
    const { service, clock } = makeService();
    const a = await service.create(sampleInput({ retention: '90d' }));
    await service.remove(a.handoff_id, a.retrieval_token);
    clock.advance(6 * DAY);
    expect((await service.cleanup()).tombstones).toBe(0);
    clock.advance(2 * DAY);
    expect((await service.cleanup()).tombstones).toBe(1);
  });

  it('purges persistent handoffs that were never used for a year, keeps ones that were', async () => {
    const { service, repo, clock } = makeService();
    const stale = await service.create(sampleInput({ retention: 'persistent' }));
    const used = await service.create(sampleInput({ retention: 'persistent' }));
    clock.advance(200 * DAY);
    await service.get(used.handoff_id, used.retrieval_token);
    clock.advance(170 * DAY);
    expect(await service.cleanup()).toEqual({ expired: 0, tombstones: 0, inactivePersistent: 1 });
    expect(repo.rows.has(stale.handoff_id)).toBe(false);
    expect(repo.rows.has(used.handoff_id)).toBe(true);
  });

  it('reports storage metrics', async () => {
    const { service } = makeService();
    await service.create(sampleInput());
    await service.create(sampleInput());
    const stats = await service.stats();
    expect(stats.active).toBe(2);
    expect(stats.activePayloadBytes).toBeGreaterThan(0);
  });
});
