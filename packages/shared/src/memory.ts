import type { FailedAttempt, MemoryInput, MemoryV1, OmissionReport, RelevantFile } from './types.js';
import { SCHEMA_VERSION } from './types.js';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const encoder = new TextEncoder();

/** Normalise line endings, strip control characters, trim. Never alters visible characters or inner spacing. */
export function cleanText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim();
}

/** Exact UTF-8 size of the compact JSON serialisation. */
export function byteSize(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

const dedupeKey = (value: string): string => value.replace(/\s+/g, ' ');

function uniqueStrings(items: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items ?? []) {
    const text = cleanText(raw);
    if (!text) continue;
    const key = dedupeKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normalizeAttempts(items: MemoryInput['failed_attempts']): FailedAttempt[] {
  const seen = new Set<string>();
  const out: FailedAttempt[] = [];
  for (const item of items ?? []) {
    const attempt = cleanText(typeof item === 'string' ? item : item.attempt);
    const result = typeof item === 'string' || item.result === undefined ? '' : cleanText(item.result);
    if (!attempt) continue;
    const key = `${dedupeKey(attempt)}\u0000${dedupeKey(result)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(result ? { attempt, result } : { attempt });
  }
  return out;
}

function normalizeFiles(items: MemoryInput['relevant_files']): RelevantFile[] {
  const byPath = new Map<string, RelevantFile>();
  for (const item of items ?? []) {
    const path = cleanText(typeof item === 'string' ? item : item.path);
    if (!path) continue;
    const note = typeof item === 'string' || item.note === undefined ? '' : cleanText(item.note);
    const symbols = typeof item === 'string' ? [] : uniqueStrings(item.symbols);
    const existing = byPath.get(path);
    if (!existing) {
      const file: RelevantFile = { path };
      if (note) file.note = note;
      if (symbols.length) file.symbols = symbols;
      byPath.set(path, file);
      continue;
    }
    if (!existing.note && note) existing.note = note;
    if (symbols.length) existing.symbols = uniqueStrings([...(existing.symbols ?? []), ...symbols]);
  }
  return [...byPath.values()];
}

/**
 * Deterministic normalisation: trims, strips control characters, removes duplicates (first occurrence wins,
 * input order preserved) and merges repeated file entries. Same input always yields the same output.
 */
export function normalizeMemory(input: MemoryInput): MemoryV1 {
  return {
    schema_version: SCHEMA_VERSION,
    project: { name: cleanText(input.project.name), stack: uniqueStrings(input.project.stack) },
    objective: cleanText(input.objective),
    requirements: uniqueStrings(input.requirements),
    decisions: uniqueStrings(input.decisions),
    completed: uniqueStrings(input.completed),
    current_state: uniqueStrings(input.current_state),
    failed_attempts: normalizeAttempts(input.failed_attempts),
    constraints: uniqueStrings(input.constraints),
    errors: uniqueStrings(input.errors),
    open_questions: uniqueStrings(input.open_questions),
    assumptions: uniqueStrings(input.assumptions),
    relevant_files: normalizeFiles(input.relevant_files),
    next_action: cleanText(input.next_action),
  };
}

type ListName =
  | 'relevant_files'
  | 'completed'
  | 'errors'
  | 'assumptions'
  | 'open_questions'
  | 'requirements'
  | 'current_state'
  | 'failed_attempts'
  | 'decisions'
  | 'constraints';

/** Least valuable first. Objective, next_action and project identity are never reduced. */
const REDUCTION_ORDER: readonly ListName[] = [
  'relevant_files',
  'completed',
  'errors',
  'assumptions',
  'open_questions',
  'requirements',
  'current_state',
  'failed_attempts',
  'decisions',
  'constraints',
];
/** Critical lists keep at least one item. */
const FLOOR: Partial<Record<ListName, number>> = {
  current_state: 1,
  failed_attempts: 1,
  decisions: 1,
  constraints: 1,
};
const REPORT_RESERVE = 600;

export class MemoryTooLargeError extends Error {
  constructor(
    public readonly budget: number,
    public readonly size: number,
  ) {
    super(
      `Memory cannot be reduced below ${size} bytes without dropping critical fields (budget ${budget}).`,
    );
    this.name = 'MemoryTooLargeError';
  }
}

function buildReport(omitted: Record<string, number>, maxBytes: number): OmissionReport {
  const parts = Object.entries(omitted).map(([field, count]) => `${field}\u00d7${count}`);
  return {
    truncated: true,
    omitted: { ...omitted },
    notes: [
      `Reduced to fit the ${maxBytes}-byte memory budget; dropped trailing items (${parts.join(', ')}). ` +
        'The full history was NOT preserved.',
    ],
  };
}

function dropOne(m: MemoryV1, omitted: Record<string, number>): boolean {
  for (const field of REDUCTION_ORDER) {
    const list = m[field] as unknown[];
    if (list.length > (FLOOR[field] ?? 0)) {
      list.pop();
      omitted[field] = (omitted[field] ?? 0) + 1;
      return true;
    }
  }
  return false;
}

/**
 * Deterministic reduction to a byte budget. Strips file symbols/notes first, then drops trailing items from the
 * least valuable lists. Always records what was omitted. Throws MemoryTooLargeError if critical content alone
 * exceeds the budget. Returns the input unchanged when it already fits.
 */
export function applyBudget(memory: MemoryV1, maxBytes: number): MemoryV1 {
  if (byteSize(memory) <= maxBytes) return memory;
  const m = structuredClone(memory);
  const omitted: Record<string, number> = { ...(memory.omitted?.omitted ?? {}) };
  let excess = byteSize(m) - Math.max(0, maxBytes - REPORT_RESERVE);

  for (const file of m.relevant_files) {
    if (excess <= 0) break;
    if (file.symbols) {
      excess -= byteSize(file.symbols) + 12;
      delete file.symbols;
      omitted.relevant_file_details = (omitted.relevant_file_details ?? 0) + 1;
    }
    if (file.note && excess > 0) {
      excess -= byteSize(file.note) + 9;
      delete file.note;
      omitted.relevant_file_details = (omitted.relevant_file_details ?? 0) + 1;
    }
  }
  for (const field of REDUCTION_ORDER) {
    const list = m[field] as unknown[];
    const floor = FLOOR[field] ?? 0;
    while (excess > 0 && list.length > floor) {
      excess -= byteSize(list.pop()) + 1;
      omitted[field] = (omitted[field] ?? 0) + 1;
    }
  }

  m.omitted = buildReport(omitted, maxBytes);
  while (byteSize(m) > maxBytes) {
    if (!dropOne(m, omitted)) throw new MemoryTooLargeError(maxBytes, byteSize(m));
    m.omitted = buildReport(omitted, maxBytes);
  }
  return m;
}
