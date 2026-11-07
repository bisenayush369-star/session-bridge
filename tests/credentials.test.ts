import { describe, expect, it } from 'vitest';
import { HANDOFF_ID_PATTERN, TOKEN_PATTERN } from '@session-bridge/shared';
import {
  generateHandoffId,
  generateRetrievalToken,
  hashToken,
  parseBearer,
  verifyToken,
} from '../apps/api/src/services/credentials.js';
import { TEST_PEPPER } from './helpers.js';

describe('credentials', () => {
  it('generates well-formed, unique ids and tokens', () => {
    const ids = new Set<string>();
    const tokens = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) {
      const id = generateHandoffId();
      const token = generateRetrievalToken();
      expect(id).toMatch(HANDOFF_ID_PATTERN);
      expect(token).toMatch(TOKEN_PATTERN);
      ids.add(id);
      tokens.add(token);
    }
    expect(ids.size).toBe(2_000);
    expect(tokens.size).toBe(2_000);
  });

  it('token carries 256 bits (43 base64url chars after the prefix) and the id is not derivable from it', () => {
    const token = generateRetrievalToken();
    expect(token.slice(4)).toHaveLength(43);
    expect(token).not.toContain(generateHandoffId().slice(3));
  });

  it('hashes to 64 hex chars, deterministically per pepper, never equal to the token', () => {
    const token = generateRetrievalToken();
    const h = hashToken(token, TEST_PEPPER);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashToken(token, TEST_PEPPER));
    expect(h).not.toBe(hashToken(token, `${TEST_PEPPER}-other`));
    expect(h).not.toContain(token);
  });

  it('verifies correct tokens and rejects wrong ones or malformed hashes', () => {
    const token = generateRetrievalToken();
    const stored = hashToken(token, TEST_PEPPER);
    expect(verifyToken(token, stored, TEST_PEPPER)).toBe(true);
    expect(verifyToken(generateRetrievalToken(), stored, TEST_PEPPER)).toBe(false);
    expect(verifyToken(token, stored, `${TEST_PEPPER}-x`)).toBe(false);
    expect(verifyToken(token, 'abcd', TEST_PEPPER)).toBe(false);
    expect(verifyToken(token, '', TEST_PEPPER)).toBe(false);
  });

  it('parses only well-formed Bearer headers', () => {
    const token = generateRetrievalToken();
    expect(parseBearer(`Bearer ${token}`)).toBe(token);
    expect(parseBearer(`bearer ${token}`)).toBe(token);
    for (const bad of [
      undefined,
      '',
      token,
      `Basic ${token}`,
      'Bearer short',
      `Bearer ${token} extra`,
      `Bearer ${token.replace('sbt_', 'xyz_')}`,
    ]) {
      expect(parseBearer(bad)).toBeNull();
    }
  });
});
