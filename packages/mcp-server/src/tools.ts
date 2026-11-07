import { redactDeep } from '@session-bridge/shared';
import { SessionBridgeApiError, type ApiClient } from './client.js';
import type { TokenStore } from './token-store.js';

export interface ToolDeps {
  client: ApiClient;
  store: TokenStore;
  /** When false the retrieval token is kept out of tool output (only possible if the local store is enabled). */
  revealToken: boolean;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

function describeError(e: unknown): ToolResult {
  if (e instanceof SessionBridgeApiError) {
    return text(`Session Bridge API error (${e.status || 'network'}, ${e.code}): ${e.message}`, true);
  }
  // The hosted endpoint calls the service in-process; its AppError carries the same status/code/message.
  const err = e as { name?: unknown; status?: unknown; code?: unknown; message?: unknown } | null;
  if (err?.name === 'AppError' && typeof err.status === 'number' && typeof err.code === 'string' && typeof err.message === 'string') {
    return text(`Session Bridge API error (${err.status}, ${err.code}): ${err.message}`, true);
  }
  return text('Session Bridge request failed unexpectedly.', true);
}

export async function createHandoffTool(deps: ToolDeps, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    // Defence in depth: redact on the client too, before anything leaves the machine.
    const { value: body, count } = redactDeep(args);
    const res = await deps.client.createHandoff(body);
    deps.store.save(res.handoff_id, res.retrieval_token, res.expires_at);
    const lines = [
      `Handoff saved. ID: ${res.handoff_id}`,
      deps.revealToken
        ? `Retrieval token (shown once, treat like a password): ${res.retrieval_token}`
        : 'Retrieval token withheld from this conversation; it is stored in the local token store.',
      `Expires: ${res.expires_at ?? 'never (persistent until deleted)'} | retention: ${res.retention} | size: ${res.payload_bytes} bytes`,
      deps.store.enabled
        ? 'Token also saved locally, so this machine only needs the ID to resume.'
        : 'Token NOT saved locally: keep it, it cannot be recovered.',
    ];
    const warnings = [...res.warnings];
    if (count > 0) warnings.push(`${count} secret-like value(s) were redacted client-side before sending.`);
    if (res.truncated) warnings.push('The stored memory was reduced to fit the size budget; see warnings above.');
    if (warnings.length) lines.push('Warnings:', ...warnings.map((w) => `- ${w}`));
    return text(lines.join('\n'));
  } catch (e) {
    return describeError(e);
  }
}

export interface ResumeArgs {
  handoff_id: string;
  retrieval_token?: string | undefined;
  max_tokens?: number | undefined;
  format?: 'text' | 'json' | 'both' | undefined;
}

export async function resumeHandoffTool(deps: ToolDeps, args: ResumeArgs): Promise<ToolResult> {
  const token = args.retrieval_token ?? deps.store.get(args.handoff_id);
  if (!token) {
    return text(
      'No retrieval token available for this handoff. Provide retrieval_token (saved when the handoff was created); the handoff ID alone cannot authorize access.',
      true,
    );
  }
  try {
    const res = await deps.client.resume(args.handoff_id, token, {
      ...(args.max_tokens !== undefined ? { max_tokens: args.max_tokens } : {}),
      ...(args.format !== undefined ? { format: args.format } : {}),
    });
    const body = res.text ?? JSON.stringify(res.package);
    const notes = [`approx tokens: ${res.approx_tokens} (${res.token_estimate})`];
    if (res.truncated) notes.push(`TRUNCATED, omitted: ${JSON.stringify(res.omitted)}`);
    return text(`${body}\n\n[${notes.join(' | ')}]`);
  } catch (e) {
    return describeError(e);
  }
}

export async function deleteHandoffTool(
  deps: ToolDeps,
  args: { handoff_id: string; retrieval_token?: string | undefined },
): Promise<ToolResult> {
  const token = args.retrieval_token ?? deps.store.get(args.handoff_id);
  if (!token) return text('No retrieval token available; deletion requires the retrieval token.', true);
  try {
    await deps.client.deleteHandoff(args.handoff_id, token);
    deps.store.remove(args.handoff_id);
    return text(`Handoff ${args.handoff_id} deleted.`);
  } catch (e) {
    return describeError(e);
  }
}

/** Archives are intentionally not implemented in this MVP. */
export function searchArchiveTool(): ToolResult {
  return text(
    'unsupported_operation: this Session Bridge deployment stores structured memory only. Full-conversation archives are not implemented, so there is nothing to search.',
    true,
  );
}
