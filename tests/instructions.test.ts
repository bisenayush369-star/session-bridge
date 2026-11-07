import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const raw = readFileSync(
  fileURLToPath(new URL('../docs/integrations/claude-ai-instructions.md', import.meta.url)),
  'utf8',
);
const blocks = [...raw.matchAll(/```text\n([\s\S]*?)\n```/g)].map((m) => m[1] ?? '');
const required = [
  '/newsession',
  '/resume',
  '=== SESSION HANDOFF ===',
  '=== END ===',
  'NEXT ACTION',
  'FAILED ATTEMPTS',
  'ASSUMPTIONS',
  'never include secrets',
  'create_handoff',
  'resume_handoff',
];

describe('claude.ai instruction blocks', () => {
  it('has a compact and a long block', () => {
    expect(blocks).toHaveLength(2);
  });

  it('keeps the compact block under the reported 1,500-character preferences limit', () => {
    expect((blocks[0] ?? '').length).toBeLessThanOrEqual(1_500);
  });

  it('both blocks define save and resume, the handoff format and the safety rules', () => {
    for (const block of blocks) for (const needle of required) expect(block).toContain(needle);
  });
});
