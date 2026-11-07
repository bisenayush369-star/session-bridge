# Claude Code integration

Claude Code can launch the local stdio MCP server and run the `/newsession` skill. Sources: Anthropic's Claude Code
documentation (skills, MCP) as read on 2026-11-03. This setup has **not** been exercised end-to-end against a live
Claude Code session; if something differs, trust the current Anthropic docs.

## Requirements

- Node >= 22.12 and a running Session Bridge API (local `npm run dev`, or your hosted https URL).
- The MCP server built once: `npm install && npm run build` (produces `packages/mcp-server/dist/index.js`).

## 1. Register the MCP server

Options go **before** the server name; `--` separates the launch command:

```bash
claude mcp add --transport stdio --scope user \
  --env SESSION_BRIDGE_API_URL=http://localhost:3000 \
  session-bridge -- node /absolute/path/to/session-bridge/packages/mcp-server/dist/index.js
claude mcp list          # confirm it is registered; inside Claude Code run /mcp to see connection status
```

Scopes: `local` (default, this project only, private), `project` (writes `.mcp.json` for the team), `user` (all your
projects). For a shared `.mcp.json`, reference an environment variable instead of a machine path:

```json
{
  "mcpServers": {
    "session-bridge": {
      "type": "stdio",
      "command": "node",
      "args": ["${SESSION_BRIDGE_HOME}/packages/mcp-server/dist/index.js"],
      "env": { "SESSION_BRIDGE_API_URL": "https://your-session-bridge.example.com" }
    }
  }
}
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_BRIDGE_API_URL` | `http://localhost:3000` | API base URL. Must be https unless host is localhost |
| `SESSION_BRIDGE_TOKEN_STORE` | `~/.session-bridge/tokens.json` | Local file (0600) holding tokens of handoffs created here; `off` disables |
| `SESSION_BRIDGE_REVEAL_TOKEN` | `true` | `false` keeps the token out of the conversation (requires the token store) |
| `SESSION_BRIDGE_TIMEOUT_MS` | `15000` | Request timeout |

The server needs no API key of its own: handoffs are protected by per-handoff tokens, so nothing private is embedded
in the skill or the MCP config.

## 2. Install the skill

```bash
mkdir -p ~/.claude/skills && cp -r packages/skill/newsession ~/.claude/skills/      # all projects
# or, committed with one project:  mkdir -p .claude/skills && cp -r packages/skill/newsession .claude/skills/
```

The directory name is the slash command. The skill pre-approves no tools, so Claude Code asks before project memory is
sent to the API; approve per call or add your own permission rules.

## 3. Use it

1. In the long session: `/newsession`. Claude builds the structured memory, calls `create_handoff`, and shows the
   handoff ID, expiry, the token (once) and any warnings (redaction, truncation).
2. In a fresh session: `/newsession resume hs_XXXXXXXXXXXXXXXX`. On the same machine the stored token is used; on
   another machine add the token when asked. Claude compares the context with the repo and continues at `next_action`.

If the MCP tools are not available Claude is instructed to say so and stop; it must not pretend to save.

## Troubleshooting

`/mcp` shows failed: run the `node .../dist/index.js` command by hand (it should wait silently on stdin and log one
line to stderr); check the absolute path and that `npm run build` ran. `unsupported`/network errors: confirm the API URL
and `curl $URL/health`. 404 on resume: wrong token, deleted, or expired and purged.
