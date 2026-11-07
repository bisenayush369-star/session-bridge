import { describe, expect, it } from 'vitest';
import { applyBudget, byteSize, MemoryTooLargeError, normalizeMemory } from '@session-bridge/shared';
import { bigInput, sampleInput, thrown } from './helpers.js';

describe('normalizeMemory', () => {
  it('trims, strips control characters, normalises CRLF and drops empty items', () => {
    const m = normalizeMemory(
      sampleInput({ decisions: ['  keep  me \r\nline2\u0007 ', '   ', ''], objective: '  Goal\u0000 ' }),
    );
    expect(m.decisions).toEqual(['keep  me \nline2']);
    expect(m.objective).toBe('Goal');
  });

  it('removes duplicates (whitespace-insensitive, case-sensitive) and preserves first-seen order', () => {
    const m = normalizeMemory(sampleInput({ completed: ['a  b', 'c', 'a b', 'A b', 'c'] }));
    expect(m.completed).toEqual(['a  b', 'c', 'A b']);
  });

  it('merges repeated files, unions symbols and keeps the first note', () => {
    const m = normalizeMemory(
      sampleInput({
        relevant_files: [
          'src/a.ts',
          { path: 'src/a.ts', symbols: ['foo'], note: 'first' },
          { path: 'src/a.ts', symbols: ['foo', 'bar'], note: 'second' },
          { path: 'src/b.ts' },
        ],
      }),
    );
    expect(m.relevant_files).toEqual([{ path: 'src/a.ts', note: 'first', symbols: ['foo', 'bar'] }, { path: 'src/b.ts' }]);
  });

  it('accepts string and object failed attempts and dedupes on attempt+result', () => {
    const m = normalizeMemory(
      sampleInput({
        failed_attempts: ['tried X', { attempt: 'tried X' }, { attempt: 'tried Y', result: 'broke' }, { attempt: 'tried Y', result: 'broke' }],
      }),
    );
    expect(m.failed_attempts).toEqual([{ attempt: 'tried X' }, { attempt: 'tried Y', result: 'broke' }]);
  });

  it('is deterministic and defaults every list to empty', () => {
    const input = sampleInput();
    expect(JSON.stringify(normalizeMemory(input))).toBe(JSON.stringify(normalizeMemory(structuredClone(input))));
    const m = normalizeMemory({ project: { name: 'P' }, objective: 'O', next_action: 'N' });
    expect(m.requirements).toEqual([]);
    expect(m.project.stack).toEqual([]);
    expect(m.schema_version).toBe(1);
  });
});

describe('applyBudget', () => {
  it('returns the same object when under budget', () => {
    const m = normalizeMemory(sampleInput());
    expect(applyBudget(m, 100_000)).toBe(m);
  });

  it('reduces deterministically, keeps critical fields and reports what was omitted', () => {
    const m = normalizeMemory(bigInput(60));
    const budget = 6_000;
    const out = applyBudget(m, budget);
    expect(byteSize(out)).toBeLessThanOrEqual(budget);
    expect(out.omitted?.truncated).toBe(true);
    expect(out.omitted?.omitted.completed).toBeGreaterThan(0);
    expect(out.omitted?.notes.join(' ')).toContain('NOT preserved');
    expect(out.objective).toBe('Fix authentication');
    expect(out.next_action).toBe('Inspect the auth callback');
    expect(out.decisions).toEqual(['Use NextAuth']);
    expect(out.constraints).toEqual(['No new paid services']);
    expect(JSON.stringify(applyBudget(m, budget))).toBe(JSON.stringify(out));
  });

  it('drops low-priority lists before critical ones', () => {
    const m = normalizeMemory(bigInput(40));
    const out = applyBudget(m, 5_000);
    expect(out.completed.length).toBeLessThan(m.completed.length);
    expect(out.current_state).toEqual(m.current_state);
    expect(out.failed_attempts).toEqual(m.failed_attempts);
  });

  it('merges omission counts when reduced a second time', () => {
    const once = applyBudget(normalizeMemory(bigInput(60)), 9_000);
    const twice = applyBudget(once, 5_000);
    expect(byteSize(twice)).toBeLessThanOrEqual(5_000);
    expect(twice.omitted?.omitted.completed).toBeGreaterThanOrEqual(once.omitted?.omitted.completed ?? 0);
  });

  it('throws when critical content alone cannot fit', () => {
    const m = normalizeMemory(sampleInput());
    expect(thrown(() => applyBudget(m, 50)) instanceof MemoryTooLargeError).toBe(true);
  });
});
