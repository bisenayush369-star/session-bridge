# Claude.ai website integration (custom connector)

> **Simplest path, no server:** teach Claude what `/newsession` means and paste the handoff block into a new chat. See
> `claude-ai-instructions.md`. The rest of this page is the optional connector route (short IDs, expiry, deletion).

Claude.ai uses **custom connectors**: remote MCP servers that Anthropic's cloud connects to over the internet. Session Bridge
ships one at `POST /mcp` (stateless Streamable HTTP, JSON responses). Every handoff is protected by its own token, passed as a
tool argument; you can additionally require a shared access key on the endpoint (step 3).

Facts below come from Anthropic's help article "Get started with custom connectors using remote MCP" (read 2026-11-03). Menu
labels and limits change, so follow that page where it differs. **The `/mcp` endpoint has not been run against the real MCP
SDK or a live claude.ai connector in the authoring environment: test it as in step 2 first.**

## Requirements

- **Plan:** the article lists custom connectors (beta) for **Free, Pro, Max, Team and Enterprise**. Free is limited to **one**
  custom connector, and Session Bridge would use that slot. On Team/Enterprise an owner adds the connector first.
- **A public https URL** for your API. Anthropic's servers make the connection, not your computer, so `localhost` cannot work.
- The mobile apps can use a connector configured on your account.

## 1. Get a public https URL

- **Quick test, nothing to deploy:** run the API locally (`npm run dev`, `TRUST_PROXY=true` in `.env`) and expose port 3000 with a
  tunnel tool such as Cloudflare Tunnel or ngrok (check their current terms). Keep the computer and tunnel running; the URL may
  change on every restart.
- **Permanent:** deploy to a host with managed PostgreSQL (README "Deployment"). Needs your own accounts and may cost money.

## 2. Test the endpoint before using claude.ai

```bash
curl -sS -X POST https://YOUR-HOST/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expect JSON listing `create_handoff`, `resume_handoff`, `delete_handoff`, `search_archive`. For a fuller check run
`npx @modelcontextprotocol/inspector`, choose Streamable HTTP and enter the URL. If it fails, fix it before involving claude.ai.

## 3. Optional but recommended: an access key

Without one, anyone who learns your URL can create handoffs (rate limited) on your server. Set `MCP_ACCESS_TOKEN` (24+ characters,
`openssl rand -base64 32`) in `.env`, restart, and `/mcp` will answer 401 unless the request carries it as
`X-Session-Bridge-Key: <key>` (or `Authorization: Bearer <key>`). The help article describes a **Request headers** option for fixed
credentials in the connector setup; if your screen offers it, add that header there. If it does not, leave `MCP_ACCESS_TOKEN`
unset (claude.ai could not send the key, and requests would be refused). Handoffs stay protected by their tokens either way.

## 4. Add the connector

Per the article, for an individual account: click **+** (or **Add**) -> **Add custom connector** (some screens: Add -> Custom ->
Web), enter the name `Session Bridge` and the URL `https://YOUR-HOST/mcp`, click **Continue**, check the authentication settings
Claude detected (an open server should show none; add the request header here if you set an access key), then **Add**.

Enable it per conversation: in the chat click **+** (lower left) -> **Connectors** -> switch **Session Bridge** on.

## 5. Use it

- **Save:** in the long chat say _"Save this conversation to Session Bridge."_ Claude calls `create_handoff` and shows the handoff
  ID, the expiry and the retrieval token once. Store the token in a password manager.
- **Resume:** in a new chat, enable the connector and say _"Resume Session Bridge handoff hs_XXXXXXXXXXXXXXXX with token sbt\_..."_.
  The token is always required on the hosted path (there is no local token store).
- **Delete:** _"Delete Session Bridge handoff hs\_... (token sbt\_...)."_
- The connector also offers `newsession` and `resume_session` prompts; I could not verify whether your UI lists MCP prompts, so
  plain wording is the reliable way. The `/newsession` **skill** is a Claude Code feature.

## Limits and risks

- The token appears in the chat (tool call and result). The transcript is as private as your account.
- Anthropic's article advises trusting only MCP servers you control or trust and disabling tools you do not need in a chat
  (Search and tools menu). Here you run the server, so the main risk is your own endpoint being public: use the access key.
- claude.ai calls come from a few shared Anthropic IPs, so `/mcp` has separate, higher per-IP limits (`RATE_LIMIT_MCP_*`).
- Reports exist of custom connectors showing "Connected" while the model is not given their tools (GitHub issue
  `anthropics/claude-ai-mcp#476`). If it happens: enable the connector in the chat, remove and re-add it (editing needs a
  re-add), and check your server logs for `POST /mcp`.

## Without a connector (manual, always works)

Ask Claude for the JSON in the schema (keys: project, objective, requirements, decisions, completed, current_state, failed_attempts,
constraints, errors, open_questions, assumptions, relevant_files, next_action; only established facts, unverified items under
`assumptions`, no secrets), save it as `handoff.json`, then:

```bash
curl -sS -X POST "$BASE/v1/handoffs" -H 'content-type: application/json' --data @handoff.json
curl -sS -X POST "$BASE/v1/handoffs/$ID/resume" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"max_tokens": 4000}' | jq -r .text   # paste into the new chat
```
