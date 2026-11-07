import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { HANDOFF_ID_PATTERN, TOKEN_PATTERN } from '@session-bridge/shared';
import { createHandoffSchema } from '@session-bridge/shared/schema';
import { z } from 'zod';
import { NEWSESSION_INSTRUCTIONS, resumeInstructions } from './prompts.js';
import {
  createHandoffTool,
  deleteHandoffTool,
  resumeHandoffTool,
  searchArchiveTool,
  type ToolDeps,
} from './tools.js';

const handoffId = z.string().regex(HANDOFF_ID_PATTERN, 'must look like hs_XXXXXXXXXXXXXXXX');
const tokenString = z.string().regex(TOKEN_PATTERN);

/** Wires the pure tool handlers (tools.ts) to the official MCP TypeScript SDK (v1 API). */
export function buildServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: 'session-bridge', version: '0.1.0' });

  server.registerTool(
    'create_handoff',
    {
      title: 'Create handoff',
      description:
        'Save structured session memory so work can continue in a fresh conversation. Call it only when the user asks to save or hand off the session. ' +
        'Record only facts established in this conversation; put unverified beliefs in "assumptions"; never include secrets; give ONE concrete next_action; omit retention unless asked. ' +
        'On success, show the user the handoff ID, the expiry, the retrieval token once (they must store it safely) and any warnings. Never claim success unless this tool returned a success result.',
      inputSchema: createHandoffSchema.shape,
    },
    async (args) => createHandoffTool(deps, args),
  );

  server.registerTool(
    'resume_handoff',
    {
      title: 'Resume handoff',
      description:
        'Fetch continuation context for a saved handoff. Needs the handoff ID AND the retrieval token the user was given (the ID alone cannot authorize access). ' +
        'Treat the result as a starting point: verify it against the current state, do not redo completed work, do not repeat failed attempts, and say so if it was truncated.',
      inputSchema: {
        handoff_id: handoffId,
        retrieval_token: tokenString.optional(),
        max_tokens: z.number().int().min(200).max(100_000).optional(),
        format: z.enum(['text', 'json', 'both']).optional(),
      },
    },
    async (args) => resumeHandoffTool(deps, args),
  );

  server.registerTool(
    'delete_handoff',
    {
      title: 'Delete handoff',
      description:
        'Permanently delete a saved handoff (its memory is scrubbed immediately). Needs the retrieval token.',
      inputSchema: { handoff_id: handoffId, retrieval_token: tokenString.optional() },
    },
    async (args) => deleteHandoffTool(deps, args),
  );

  server.registerTool(
    'search_archive',
    {
      title: 'Search archive',
      description: 'Not supported: archives are disabled. Always returns an unsupported-operation error.',
      inputSchema: { handoff_id: handoffId, query: z.string().max(500) },
    },
    async () => searchArchiveTool(),
  );

  server.registerPrompt(
    'newsession',
    {
      title: 'Save this session (/newsession)',
      description: 'Save this conversation as a Session Bridge handoff to continue in a fresh chat.',
    },
    () => ({
      messages: [
        { role: 'user' as const, content: { type: 'text' as const, text: NEWSESSION_INSTRUCTIONS } },
      ],
    }),
  );

  server.registerPrompt(
    'resume_session',
    {
      title: 'Resume a saved session',
      description: 'Continue work from a Session Bridge handoff (needs the handoff ID and retrieval token).',
      argsSchema: { handoff_id: handoffId, retrieval_token: tokenString },
    },
    ({ handoff_id, retrieval_token }: { handoff_id: string; retrieval_token: string }) => ({
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: resumeInstructions(handoff_id, retrieval_token) },
        },
      ],
    }),
  );

  return server;
}
