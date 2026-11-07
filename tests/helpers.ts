import type { MemoryInput } from '@session-bridge/shared';
import { HandoffService, type ServiceConfig } from '../apps/api/src/services/handoff-service.js';
import { InMemoryHandoffRepository } from '../apps/api/src/services/memory-repository.js';

export const TEST_PEPPER = 'test-pepper-test-pepper-test-pepper-0123456789';
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export class FakeClock {
  constructor(private t = Date.parse('2026-11-03T00:00:00.000Z')) {}
  now(): number {
    return this.t;
  }
  date(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

export type SampleInput = MemoryInput & { retention?: unknown };

export function sampleInput(over: Partial<SampleInput> = {}): SampleInput {
  return {
    project: { name: 'Demo', stack: ['Next.js', 'TypeScript'] },
    objective: 'Fix authentication',
    decisions: ['Use NextAuth'],
    completed: ['Set up providers'],
    current_state: ['Callback returns 500'],
    failed_attempts: [{ attempt: 'Changed cookie domain', result: 'No effect' }],
    constraints: ['No new paid services'],
    relevant_files: [{ path: 'src/auth.ts', symbols: ['callbacks'] }],
    next_action: 'Inspect the auth callback',
    ...over,
  };
}

export function bigInput(n: number, over: Partial<SampleInput> = {}): SampleInput {
  return sampleInput({
    completed: Array.from({ length: n }, (_, i) => `completed item ${i} ${'x'.repeat(100)}`),
    requirements: Array.from({ length: n }, (_, i) => `requirement ${i} ${'y'.repeat(100)}`),
    ...over,
  });
}

export function makeService(over: Partial<ServiceConfig> = {}, generateId?: () => string) {
  const clock = new FakeClock();
  const repo = new InMemoryHandoffRepository();
  const config: ServiceConfig = {
    tokenPepper: TEST_PEPPER,
    defaultRetention: '30d',
    allowPersistent: true,
    memoryBudgetBytes: 65_536,
    redactSecrets: true,
    persistentInactivityDays: 365,
    tombstoneDays: 7,
    ...over,
  };
  const service = new HandoffService({ repo, config, now: () => clock.date(), ...(generateId ? { generateId } : {}) });
  return { clock, repo, service, config };
}

/** Resolves with the rejection value (typed loosely) or fails if the promise resolves. */
export async function rejection(p: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await p;
  } catch (e) {
    return e as Record<string, unknown>;
  }
  throw new Error('expected the promise to reject');
}

export function thrown(fn: () => unknown): Record<string, unknown> {
  try {
    fn();
  } catch (e) {
    return e as Record<string, unknown>;
  }
  throw new Error('expected the function to throw');
}
