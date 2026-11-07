#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SessionBridgeClient } from './client.js';
import { buildServer } from './server.js';
import { tokenStoreFromEnv } from './token-store.js';

// stdout carries the MCP protocol: only ever write diagnostics to stderr.
const baseUrl = process.env.SESSION_BRIDGE_API_URL ?? 'http://localhost:3000';
const store = tokenStoreFromEnv(process.env);
const revealToken = process.env.SESSION_BRIDGE_REVEAL_TOKEN !== 'false';
if (!revealToken && !store.enabled) {
  console.error('SESSION_BRIDGE_REVEAL_TOKEN=false requires the local token store (do not set SESSION_BRIDGE_TOKEN_STORE=off).');
  process.exit(1);
}

const client = new SessionBridgeClient(baseUrl, Number(process.env.SESSION_BRIDGE_TIMEOUT_MS) || 15_000);
await buildServer({ client, store, revealToken }).connect(new StdioServerTransport());
console.error(`session-bridge MCP server ready (api: ${new URL(baseUrl).origin})`);
