import { describe, expect, it } from 'vitest';
import { createHandoffSchema, resumeRequestSchema } from '@session-bridge/shared/schema';

const example = {
  project: { name: 'Example Project', stack: ['Next.js', 'TypeScript', 'PostgreSQL'] },
  objective: 'Fix authentication',
  decisions: [],
  completed: [],
  current_state: [],
  failed_attempts: [],
  constraints: [],
  open_questions: [],
  relevant_files: [],
  next_action: 'Inspect the authentication callback',
  retention: '30d',
};

describe('createHandoffSchema', () => {
  it('accepts the documented example and applies defaults', () => {
    expect(createHandoffSchema.safeParse(example).success).toBe(true);
    const min = createHandoffSchema.parse({ project: { name: 'P' }, objective: 'O', next_action: 'N' });
    expect(min.requirements).toEqual([]);
    expect(min.project.stack).toEqual([]);
    expect(min.retention).toBeUndefined();
  });

  it('rejects unknown keys, bad retention, blank strings and oversize fields', () => {
    expect(createHandoffSchema.safeParse({ ...example, extra: 1 }).success).toBe(false);
    expect(createHandoffSchema.safeParse({ ...example, retention: 'forever' }).success).toBe(false);
    expect(createHandoffSchema.safeParse({ ...example, objective: '   ' }).success).toBe(false);
    expect(createHandoffSchema.safeParse({ ...example, objective: 'x'.repeat(2_001) }).success).toBe(false);
    expect(createHandoffSchema.safeParse({ ...example, decisions: Array(201).fill('d') }).success).toBe(false);
  });

  it('accepts string and object forms for attempts and files', () => {
    const r = createHandoffSchema.safeParse({
      ...example,
      failed_attempts: ['a', { attempt: 'b', result: 'c' }],
      relevant_files: ['x.ts', { path: 'y.ts', symbols: ['f'], note: 'n' }],
    });
    expect(r.success).toBe(true);
  });
});

describe('resumeRequestSchema', () => {
  it('defaults to text and bounds max_tokens', () => {
    expect(resumeRequestSchema.parse({}).format).toBe('text');
    expect(resumeRequestSchema.safeParse({ max_tokens: 5 }).success).toBe(false);
    expect(resumeRequestSchema.safeParse({ format: 'xml' }).success).toBe(false);
  });
});
