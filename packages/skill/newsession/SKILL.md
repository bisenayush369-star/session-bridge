---
name: newsession
description: Save this session's context as a Session Bridge handoff (/newsession) or resume one in a fresh chat from its hs_ ID. Needs the session-bridge MCP tools create_handoff and resume_handoff.
argument-hint: '[resume <handoff_id>]'
---

# /newsession: hand off work to a fresh conversation

Two modes. Choose from the user's request:

- **Save** (default: `/newsession`, "start a new session", "save context for a fresh chat").
- **Resume** (`/newsession resume hs_...`, or the user gives an `hs_` handoff ID and wants to continue).

## Preconditions (check first, never fake)

1. Confirm the MCP tools `create_handoff` and `resume_handoff` (server `session-bridge`) are available.
   If they are not, say so plainly, point the user to the Session Bridge README for MCP setup, and stop.
   Do not simulate a save, do not invent IDs or tokens, do not call arbitrary HTTP endpoints.
2. Never put secrets (API keys, tokens, passwords, credentialed URLs) in a handoff. Refer to them by name only
   ("uses STRIPE_API_KEY from .env").

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
