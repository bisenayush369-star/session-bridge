import { describe, expect, it } from 'vitest';
import { redactDeep, redactSecrets } from '@session-bridge/shared';

const cases: Array<[string, string]> = [
  ['anthropic-key', 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 end'],
  ['openai-key', 'OPENAI sk-proj-abcdefghijklmnopqrstuvwxyz123456'],
  ['github-token', 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB'],
  ['aws-access-key', 'AKIAIOSFODNN7EXAMPLE'],
  ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'],
  [
    'private-key',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA PRIVATE KEY-----',
  ],
  ['session-bridge-token', 'sbt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'],
  ['bearer-token', 'Authorization: Bearer abcdefghijklmnop0123456789'],
  ['url-credentials', 'postgres://admin:s3cretpass@db.example.com:5432/app'],
  ['secret', 'password = "hunter2hunter2"'],
  ['secret', 'API_KEY=abcd1234efgh5678'],
];

describe('redactSecrets', () => {
  for (const [kind, input] of cases) {
    it(`redacts ${kind}`, () => {
      const r = redactSecrets(input);
      expect(r.count).toBeGreaterThan(0);
      expect(r.text).toContain(`[REDACTED:${kind}]`);
      expect(r.text).not.toMatch(
        /hunter2hunter2|abcd1234efgh5678|s3cretpass|AKIAIOSFODNN7EXAMPLE|abcdefghijklmnop/,
      );
    });
  }

  it('leaves ordinary text and code references alone', () => {
    for (const s of [
      'The quick brown fox, version 1.2.3, listens on port 8080.',
      'const token = process.env.TOKEN_SECRET_VALUE;',
      'max_token = 20000000',
      'password: <your-password>',
      'tokenizer: string',
    ]) {
      expect(redactSecrets(s)).toEqual({ text: s, count: 0 });
    }
  });

  it('keeps the credential-free parts of a URL', () => {
    expect(redactSecrets('postgres://u:p4ssw0rdX@host/db').text).toBe(
      'postgres://[REDACTED:url-credentials]@host/db',
    );
  });
});

describe('redactDeep', () => {
  it('redacts strings inside nested objects and arrays and leaves other values alone', () => {
    const input = {
      a: ['ok', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'],
      b: { n: 5, flag: true, c: 'API_KEY=abcd1234efgh5678' },
    };
    const { value, count } = redactDeep(input);
    expect(count).toBe(2);
    expect(JSON.stringify(value)).not.toContain('sk-ant');
    expect(value.b.n).toBe(5);
    expect(value.b.flag).toBe(true);
    expect(input.a[1]).toContain('sk-ant');
  });
});
