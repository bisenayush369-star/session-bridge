/** Core (zod-free) types and constants shared by the API and the MCP server. */

export const SCHEMA_VERSION = 1 as const;

export const RETENTION_VALUES = ['24h', '30d', '90d', 'persistent'] as const;
export type Retention = (typeof RETENTION_VALUES)[number];
/** Persistent retention is never a default; it must be requested explicitly. */
export const DEFAULT_RETENTION: Retention = '30d';

/** Field-level caps. The overall byte budget is enforced separately (MAX_BODY_BYTES / MEMORY_BUDGET_BYTES). */
export const LIMITS = {
  projectName: 200,
  stackItems: 50,
  stackItem: 100,
  objective: 2_000,
  nextAction: 2_000,
  listItems: 200,
  listItem: 4_000,
  attemptText: 2_000,
  attemptResult: 2_000,
  files: 200,
  filePath: 500,
  fileNote: 500,
  fileSymbols: 50,
  fileSymbol: 120,
} as const;

/** Handoff IDs are public identifiers, NOT credentials. */
export const HANDOFF_ID_PATTERN = /^hs_[A-Za-z0-9_-]{16}$/;
/** Retrieval tokens are bearer credentials: 256 random bits, base64url. */
export const TOKEN_PATTERN = /^sbt_[A-Za-z0-9_-]{43}$/;

export interface FailedAttempt {
  attempt: string;
  result?: string;
}

export interface RelevantFile {
  path: string;
  note?: string;
  symbols?: string[];
}

/** Shape accepted by the memory engine (already validated by zod at the API edge). */
export interface MemoryInput {
  project: { name: string; stack?: string[] };
  objective: string;
  requirements?: string[];
  decisions?: string[];
  completed?: string[];
  current_state?: string[];
  failed_attempts?: Array<string | FailedAttempt>;
  constraints?: string[];
  errors?: string[];
  open_questions?: string[];
  /** Things believed but not verified. Kept separate from confirmed facts. */
  assumptions?: string[];
  relevant_files?: Array<string | RelevantFile>;
  next_action: string;
}

export interface OmissionReport {
  truncated: true;
  /** Count of items (or file details) dropped, by field. */
  omitted: Record<string, number>;
  notes: string[];
}

/** Canonical stored memory, schema version 1. */
export interface MemoryV1 {
  schema_version: typeof SCHEMA_VERSION;
  project: { name: string; stack: string[] };
  objective: string;
  requirements: string[];
  decisions: string[];
  completed: string[];
  current_state: string[];
  failed_attempts: FailedAttempt[];
  constraints: string[];
  errors: string[];
  open_questions: string[];
  assumptions: string[];
  relevant_files: RelevantFile[];
  next_action: string;
  omitted?: OmissionReport;
}
