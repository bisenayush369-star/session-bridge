import { describe, expect, it } from 'vitest';
import { applyBudget, buildResume, normalizeMemory, renderResumeText } from '@session-bridge/shared';
import { bigInput, sampleInput } from './helpers.js';

const ID = 'hs_AAAAAAAAAAAAAAAA';

describe('resume package', () => {
  it('includes every required section and the exact next action', () => {
    const text = renderResumeText(normalizeMemory(sampleInput({ assumptions: ['DB is Postgres 16'] })), ID);
    for (const needle of [
      ID,
      '## Objective\nFix authentication',
      '## Architecture decisions\n- Use NextAuth',
      '## Completed\n- Set up providers',
      '## Current state\n- Callback returns 500',
      '## Failed attempts (do not repeat)\n- Changed cookie domain → No effect',
      '## Constraints\n- No new paid services',
      '## Assumptions (unverified)\n- DB is Postgres 16',
      'src/auth.ts (symbols: callbacks)',
      '## Next action\nInspect the auth callback',
      'Archive: not available',
    ]) {
      expect(text).toContain(needle);
    }
  });

  it('omits empty sections and never invents archive data', () => {
    const r = buildResume(normalizeMemory({ project: { name: 'P' }, objective: 'O', next_action: 'N' }), { handoffId: ID });
    expect(r.text).not.toContain('## Completed');
    expect(r.archive).toEqual({ available: false, reference: null });
    expect(r.truncated).toBe(false);
    expect(r.token_estimate).toContain('approximate');
  });

  it('reduces to a token budget and reports the omission', () => {
    const memory = normalizeMemory(bigInput(80));
    const full = buildResume(memory, { handoffId: ID });
    const small = buildResume(memory, { handoffId: ID, maxTokens: 1_500 });
    expect(full.approx_tokens).toBeGreaterThan(small.approx_tokens);
    expect(small.approx_tokens).toBeLessThanOrEqual(1_500);
    expect(small.truncated).toBe(true);
    expect(small.text).toContain('NOT preserved');
    expect(small.text).toContain('## Next action\nInspect the auth callback');
  });

  it('flags over-budget output instead of pretending it fits', () => {
    const memory = normalizeMemory(sampleInput({ objective: 'o'.repeat(1_900), next_action: 'n'.repeat(1_900) }));
    const r = buildResume(memory, { handoffId: ID, maxTokens: 200 });
    expect(r.over_budget).toBe(true);
  });

  it('surfaces omission notes already stored with the memory', () => {
    const stored = applyBudget(normalizeMemory(bigInput(60)), 6_000);
    const r = buildResume(stored, { handoffId: ID });
    expect(r.truncated).toBe(true);
    expect(r.text).toContain('Reduced to fit');
  });
});
