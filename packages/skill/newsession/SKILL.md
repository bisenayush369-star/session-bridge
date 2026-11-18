---
name: newsession
description: Save a portable handoff archive with a summary and files (/newsession), or resume it in a fresh chat. No server required; Session Bridge MCP tools are optional.
argument-hint: '[resume <handoff_id>]'
---

# /newsession: hand off work to a fresh conversation

Two modes. Choose from the user's request:

- **Save** (default: `/newsession`, "start a new session", "save context for a fresh chat").
- **Resume** (`/newsession resume hs_...`, or the user gives an `hs_` handoff ID and wants to continue).

## Preconditions (never fake)

1. For a hosted handoff, confirm the MCP tools `create_handoff` and `resume_handoff` (server `session-bridge`) are available.
   If they are unavailable, use the portable archive workflow below. Do not simulate a save or invent IDs/tokens.
2. Never put secrets (API keys, tokens, passwords, credentialed URLs) in a handoff or archive. Refer to them by name only
   ("uses STRIPE_API_KEY from .env").

## Portable handoff (zero setup)

This skill works without the Session Bridge server, database, connector or account when Claude has Code execution and file creation enabled.

### Portable save

When the user invokes `/newsession` or asks to save for a fresh chat:

1. Write `handoff.md` with objective, requirements, decisions, completed work, current state, failed attempts, constraints, open questions, assumptions, relevant files, next action and exact technical details.
2. Copy the actual relevant files and directory structure into a handoff archive such as `newsession-handoff.zip`. Include source/configuration files needed to continue, but omit secrets, credentials, generated dependencies and unrelated files. Never copy `.env`, private keys, credentialed URLs or tokens; name them only by variable or secret name.
3. Create a download link for the archive. Tell the user to attach the archive in a new chat and send `/newsession resume`.
4. Do not use or claim a Session Bridge server unless `create_handoff` tools are actually available.

### Portable resume

When the user attaches a handoff archive and sends `/newsession resume`, read `handoff.md`, extract the included files, compare the summary with the current workspace, treat assumptions as unverified, do not redo completed work and continue at next action.

## Save workflow

1. Review the conversation and, if you have file tools, the repo state (`git status`, `git diff --stat`, files
   touched). Record only what you actually saw or did.
2. Build the structured memory and call `create_handoff`:
   - `project.name`, `project.stack`; `objective` (1-2 sentences)
   - `requirements`: what the user explicitly asked for
   - `decisions`: design choices and the reason for each
   - `completed`: finished work, specific (files, functions)
   - `current_state`: what works and what is broken now, with exact error text
   - `failed_attempts`: `{attempt, result}` pairs so they are not repeated
   - `constraints`: hard limits (versions, budgets, "do not touch X")
   - `errors`: important errors verbatim; `open_questions`
   - `assumptions`: anything not verified. Keep unverified beliefs here, never among facts
   - `relevant_files`: path with optional `symbols` and `note`
   - `next_action`: ONE concrete next step
   - `retention`: omit unless asked (`24h`, `30d` default, `90d`; `persistent` only on explicit request)
3. If the tool fails, report the error. Do not retry blindly.
4. Only after a success result, show the handoff ID, the expiry, the retrieval token once with a warning to store
   it safely, and any warnings (redaction, truncation). Never write the token into project files or commits.
5. Tell the user how to continue: open a fresh conversation and run `/newsession resume <handoff_id>`
   (add the retrieval token on another machine or if asked).

## Resume workflow

1. Call `resume_handoff` with the handoff ID (and `retrieval_token` only if the user supplies it or the tool says
   it is needed). If it fails (expired, revoked, not found, rate limited), report that and stop. Never guess content.
2. Compare the returned context with the current project state when you can (`git status`, open the listed
   files). List any drift in a few lines.
3. Treat `assumptions` as unverified. Do not redo `completed` work. Do not repeat `failed_attempts`.
4. If the response says it was truncated or items were omitted, say so. Never claim the full history was restored.
5. Continue with `next_action`. Ask the user only if the saved state contradicts the repo in a way you cannot
   resolve yourself.
6. Fetch more only when needed: call `resume_handoff` again with `format: "json"` for the structured package.
   `search_archive` is not supported in this version; do not call it.
