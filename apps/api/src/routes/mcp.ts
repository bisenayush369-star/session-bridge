import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { buildServer, disabledTokenStore } from '@session-bridge/mcp-server';
import { createHandoffSchema } from '@session-bridge/shared/schema';
import type { AppDeps } from '../app.js';
import { assertMcpAccess } from '../middleware/mcp-access.js';
import { createInProcessClient, type CreateParser } from '../services/remote-client.js';

const parseCreate: CreateParser = (body) => {
  const r = createHandoffSchema.safeParse(body);
  if (r.success) return { ok: true, data: r.data };
  return {
    ok: false,
    message: r.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; '),
  };
};

/**
 * Hosted, stateless MCP endpoint (Streamable HTTP, JSON responses) for claude.ai custom connectors.
 * No server credential exists: every handoff is still protected by its own retrieval token, passed as a tool
 * argument. A fresh MCP server instance serves each request, so nothing is kept in memory between calls.
 */
export function registerMcpRoute(app: FastifyInstance, deps: AppDeps): void {
  app.post('/mcp', async (req, reply) => {
    assertMcpAccess(deps.guard, req.ip, deps.config.mcpAccessToken, req.headers);
    const client = createInProcessClient({
      service: deps.service,
      guard: deps.guard,
      ip: req.ip,
      parseCreate,
    });
    const server = buildServer({ client, store: disabledTokenStore, revealToken: true });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.hijack(); // the transport writes the response itself
    reply.raw.setHeader('Cache-Control', 'no-store');
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (e) {
      req.log.error({ errType: e instanceof Error ? e.name : 'unknown' }, 'mcp request failed');
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.setHeader('content-type', 'application/json');
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }),
        );
      }
    }
  });

  const methodNotAllowed = (
    _req: unknown,
    reply: { code: (n: number) => { header: (k: string, v: string) => { send: (b: unknown) => unknown } } },
  ) =>
    reply
      .code(405)
      .header('Allow', 'POST')
      .send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}
