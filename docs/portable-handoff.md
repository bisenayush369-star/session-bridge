# Portable `/newsession` handoff

The `packages/skill/newsession.zip` skill gives claude.ai a zero-setup way to save and resume work. Download the zip,
don't unzip it, then upload it under **Settings -> Capabilities -> Skills** after enabling Code execution and file
creation.

## Save

In a long chat, send `/newsession`. Claude creates a handoff archive containing:

- `handoff.md`: objective, requirements, decisions, completed work, current state, failed attempts, constraints,
  open questions, assumptions, relevant files and the next action;
- copies of the relevant source/configuration files needed to continue.

Claude provides a download link. Open the archive, review it, remove private or unrelated files, and never include
`.env` files, private keys, passwords, API keys, tokens or credentialed URLs. Refer to secrets by variable name only.

## Resume

Start a new chat, attach the handoff archive, and send `/newsession resume`. Claude reads `handoff.md`, restores the
included files where appropriate, compares the summary to the current workspace, treats assumptions as unverified, and
continues from the next action without repeating completed or failed work.

This mode needs no Session Bridge server, database, public address, tunnel or account. The archive is stored wherever
you choose, so apply the same retention and sharing rules you use for source files.

## Optional self-hosted connector

The connector in [integrations/claude-ai.md](integrations/claude-ai.md) is optional. It stores summaries behind an ID
and retrieval token with expiry. It needs a public HTTPS address and a machine or hosting service that stays available.
If `MCP_ACCESS_TOKEN` is enabled, add `X-Session-Bridge-Key: <key>` under **Request headers** in the Claude custom
connector dialog. The smoke test must receive the same key through `MCP_ACCESS_TOKEN`.
