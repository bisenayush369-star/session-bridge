import { z } from 'zod';
import { LIMITS, RETENTION_VALUES } from './types.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const textList = z.array(text(LIMITS.listItem)).max(LIMITS.listItems).default([]);

const failedAttempt = z.union([
  text(LIMITS.attemptText),
  z.object({ attempt: text(LIMITS.attemptText), result: text(LIMITS.attemptResult).optional() }).strict(),
]);

const relevantFile = z.union([
  text(LIMITS.filePath),
  z
    .object({
      path: text(LIMITS.filePath),
      note: text(LIMITS.fileNote).optional(),
      symbols: z.array(text(LIMITS.fileSymbol)).max(LIMITS.fileSymbols).optional(),
    })
    .strict(),
]);

/** POST /v1/handoffs body. Unknown keys are rejected. */
export const createHandoffSchema = z
  .object({
    project: z
      .object({
        name: text(LIMITS.projectName),
        stack: z.array(text(LIMITS.stackItem)).max(LIMITS.stackItems).default([]),
      })
      .strict(),
    objective: text(LIMITS.objective),
    requirements: textList,
    decisions: textList,
    completed: textList,
    current_state: textList,
    failed_attempts: z.array(failedAttempt).max(LIMITS.listItems).default([]),
    constraints: textList,
    errors: textList,
    open_questions: textList,
    assumptions: textList,
    relevant_files: z.array(relevantFile).max(LIMITS.files).default([]),
    next_action: text(LIMITS.nextAction),
    retention: z.enum(RETENTION_VALUES).optional(),
  })
  .strict();

export type CreateHandoffInput = z.input<typeof createHandoffSchema>;
export type ParsedCreateHandoff = z.output<typeof createHandoffSchema>;

/** POST /v1/handoffs/:id/resume body (optional; send {} or nothing). */
export const resumeRequestSchema = z
  .object({
    max_tokens: z.number().int().min(200).max(100_000).optional(),
    format: z.enum(['text', 'json', 'both']).default('text'),
  })
  .strict();
export type ResumeRequest = z.output<typeof resumeRequestSchema>;
