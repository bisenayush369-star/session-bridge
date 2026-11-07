import { applyBudget, byteSize, MemoryTooLargeError } from './memory.js';
import { estimateTokens, TOKEN_ESTIMATE_NOTE } from './tokens.js';
import type { MemoryV1 } from './types.js';

export interface ResumeResult {
  text: string;
  approx_tokens: number;
  token_estimate: string;
  truncated: boolean;
  omitted: Record<string, number>;
  /** Archives are not implemented; there is never an archive to reference. */
  archive: { available: false; reference: null };
  over_budget: boolean;
  memory: MemoryV1;
}

const bullets = (items: readonly string[]): string => items.map((i) => `- ${i}`).join('\n');

export function renderResumeText(m: MemoryV1, handoffId: string): string {
  const sections: string[] = [
    `# Session handoff ${handoffId} (schema v${m.schema_version})`,
    'You are resuming unfinished work from an earlier session. Treat this summary as a starting point, not proof: ' +
      'verify it against the current repository state before editing, do not redo completed work, and do not repeat ' +
      'failed attempts.',
    `## Project\n${m.project.name}${m.project.stack.length ? ` — stack: ${m.project.stack.join(', ')}` : ''}`,
    `## Objective\n${m.objective}`,
  ];
  const add = (title: string, items: readonly string[]): void => {
    if (items.length) sections.push(`## ${title}\n${bullets(items)}`);
  };
  add('Requirements (from the user)', m.requirements);
  add('Constraints', m.constraints);
  add('Architecture decisions', m.decisions);
  add('Completed', m.completed);
  add('Current state', m.current_state);
  add(
    'Failed attempts (do not repeat)',
    m.failed_attempts.map((f) => (f.result ? `${f.attempt} → ${f.result}` : f.attempt)),
  );
  add('Important errors', m.errors);
  add('Open questions', m.open_questions);
  add('Assumptions (unverified)', m.assumptions);
  add(
    'Relevant files',
    m.relevant_files.map(
      (f) =>
        `${f.path}${f.symbols?.length ? ` (symbols: ${f.symbols.join(', ')})` : ''}${f.note ? ` — ${f.note}` : ''}`,
    ),
  );
  sections.push(`## Next action\n${m.next_action}`);
  const limits = ['Archive: not available (structured memory only; no full conversation is stored).'];
  if (m.omitted) limits.push(...m.omitted.notes);
  sections.push(`## Context limits\n${bullets(limits)}`);
  return sections.join('\n\n');
}

export interface ResumeOptions {
  handoffId: string;
  /** Approximate token budget for the rendered text. Reduction is deterministic and always reported. */
  maxTokens?: number;
}

export function buildResume(memory: MemoryV1, opts: ResumeOptions): ResumeResult {
  let current = memory;
  let text = renderResumeText(current, opts.handoffId);
  let overBudget = false;
  if (opts.maxTokens !== undefined) {
    for (let i = 0; i < 8 && estimateTokens(text).approx_tokens > opts.maxTokens; i += 1) {
      try {
        current = applyBudget(current, Math.max(1_024, Math.floor(byteSize(current) * 0.8)));
      } catch (e) {
        if (!(e instanceof MemoryTooLargeError)) throw e;
        break;
      }
      text = renderResumeText(current, opts.handoffId);
    }
    overBudget = estimateTokens(text).approx_tokens > opts.maxTokens;
  }
  return {
    text,
    approx_tokens: estimateTokens(text).approx_tokens,
    token_estimate: TOKEN_ESTIMATE_NOTE,
    truncated: current.omitted !== undefined,
    omitted: current.omitted?.omitted ?? {},
    archive: { available: false, reference: null },
    over_budget: overBudget,
    memory: current,
  };
}
