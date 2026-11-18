import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const file = fileURLToPath(new URL('../packages/skill/newsession/SKILL.md', import.meta.url));
const raw = readFileSync(file, 'utf8');
const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
const front = Object.fromEntries(
  (match?.[1] ?? '').split('\n').map((line) => {
    const i = line.indexOf(':');
    return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
  }),
);

describe('portable newsession skill', () => {
  it('documents zero-setup save and resume workflows', () => {
    expect(raw).toContain('Portable handoff (zero setup)');
    expect(raw).toContain('newsession-handoff.zip');
    expect(raw).toContain('/newsession resume');
  });

  it('allows the smoke test to send an optional MCP access key', () => {
    const smoke = readFileSync(fileURLToPath(new URL('../scripts/smoke.mjs', import.meta.url)), 'utf8');
    expect(smoke).toContain('process.env.MCP_ACCESS_TOKEN');
    expect(smoke).toContain("'X-Session-Bridge-Key': mcpAccessToken");
  });

  it('has an uploadable zip artifact beside the skill package', () => {
    const zip = fileURLToPath(new URL('../packages/skill/newsession.zip', import.meta.url));
    expect(readFileSync(zip).byteLength).toBeGreaterThan(100);
  });
});

describe('newsession SKILL.md', () => {
  it('has valid frontmatter whose name matches its directory', () => {
    expect(match).not.toBeNull();
    expect(front.name).toBe('newsession');
    expect((front.description ?? '').length).toBeGreaterThan(40);
    expect((front.description ?? '').length).toBeLessThanOrEqual(200);
  });

  it('stays small and pre-approves no tools', () => {
    expect(raw.split('\n').length).toBeLessThan(500);
    expect(raw).not.toMatch(/allowed-tools/);
  });

  it('drives the MCP tools, forbids faking results and covers save and resume', () => {
    for (const needle of [
      'create_handoff',
      'resume_handoff',
      'search_archive',
      'never fake',
      'Do not simulate',
      'Save workflow',
      'Resume workflow',
      'failed_attempts',
      'next_action',
    ]) {
      expect(raw).toContain(needle);
    }
  });
});
