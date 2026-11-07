import { describe, expect, it } from 'vitest';
import { NEWSESSION_INSTRUCTIONS, resumeInstructions } from '../packages/mcp-server/src/prompts.js';

describe('MCP prompts for claude.ai', () => {
  it('newsession prompt forbids faking saves and secrets and asks for the token once', () => {
    for (const needle of [
      'create_handoff',
      'Never pretend to save',
      'assumptions',
      'next_action',
      'Never include secrets',
      'retrieval token once',
    ]) {
      expect(NEWSESSION_INSTRUCTIONS).toContain(needle);
    }
  });

  it('resume prompt carries the id and token and the verify-first rules', () => {
    const text = resumeInstructions('hs_AAAAAAAAAAAAAAAA', `sbt_${'B'.repeat(43)}`);
    expect(text).toContain('hs_AAAAAAAAAAAAAAAA');
    expect(text).toContain('sbt_');
    expect(text).toContain('do not redo completed work');
    expect(text).toContain('do not repeat failed attempts');
  });
});
