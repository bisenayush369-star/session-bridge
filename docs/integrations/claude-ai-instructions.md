# Claude.ai without a server: `/newsession` as a pasted handoff

The simplest way to get the workflow on the Claude website needs **no server, tunnel, database or connector**: you teach
Claude what `/newsession` means. When a chat gets big, type `/newsession`; Claude writes a compact handoff block; you copy it
into a fresh chat and keep going.

The Session Bridge server and connector (see `claude-ai.md`) are optional and only add short IDs, expiry/deletion and storage.

## 1. Compact instructions (Settings -> Profile preferences)

On claude.ai click your initials (lower left) -> **Settings** -> the preferences box ("What personal preferences should Claude
consider in responses?") and paste the block below. Help-center sources say it applies to every plan, including Free, and to
new chats; one third-party guide reports a limit of about 1,500 characters, so this block is kept under that
(974 characters). Preferences may not apply to a chat that was already open: in that case paste the block as your first
message there.

```text
/newsession (or newsession) = save this chat so I can continue in a fresh chat. If Session Bridge tools are available, call create_handoff and show me the ID, expiry and token once; tell me to send "/resume <ID> <TOKEN>" in a new chat. Otherwise output ONE code block:
=== SESSION HANDOFF ===
PROJECT/STACK:
OBJECTIVE:
REQUIREMENTS:
CONSTRAINTS:
DECISIONS (why):
COMPLETED:
CURRENT STATE (exact errors):
FAILED ATTEMPTS (attempt -> result):
OPEN QUESTIONS:
ASSUMPTIONS (unverified):
FILES:
NEXT ACTION (one step):
=== END ===
Only what this chat established; guesses go under ASSUMPTIONS; never include secrets (name them only); skip empty sections; keep exact names, paths, commands and error text.
When I paste a SESSION HANDOFF block, or send "/resume <ID> <TOKEN>" (then call resume_handoff), treat it as saved context: don't redo COMPLETED work, don't repeat FAILED ATTEMPTS, treat ASSUMPTIONS as unverified, flag gaps or contradictions, then continue from NEXT ACTION.
```

## 2. Longer version (Project instructions, or paste as a message)

Same behaviour with more explicit rules. Use it in a Project's instructions where your plan has Projects, or paste it as a
message at the start of a chat.

```text
SESSION HANDOFF COMMANDS

When I send "/newsession" (or "newsession"):
1. Stop the current task. Write a handoff of this conversation so I can continue in a fresh chat.
2. If the Session Bridge connector tools are available in this chat, call create_handoff with the structured fields (project name and stack, objective, requirements, decisions, completed, current_state, failed_attempts, constraints, errors, open_questions, assumptions, relevant_files, next_action). After a success result, show me the handoff ID, the expiry and the retrieval token once, and tell me to start a new chat and send: /resume <ID> <TOKEN>. If the tool fails, say so and use step 3.
3. Otherwise output the handoff as ONE code block in exactly this format and tell me to copy it into a new chat:

=== SESSION HANDOFF ===
PROJECT/STACK:
OBJECTIVE: (1-2 sentences)
REQUIREMENTS: (what I explicitly asked for)
CONSTRAINTS: (versions, budgets, "do not touch X")
DECISIONS (why): (each with its reason)
COMPLETED: (specific: files, functions, results)
CURRENT STATE (exact errors): (what works, what is broken now)
FAILED ATTEMPTS (attempt -> result): (so they are not repeated)
OPEN QUESTIONS:
ASSUMPTIONS (unverified):
FILES: (path, symbols, note)
NEXT ACTION (one step): (ONE concrete step)
=== END ===

Rules: include only what was actually established in this conversation; put guesses under ASSUMPTIONS; never include secrets (API keys, passwords, tokens), name them only; skip empty sections; keep exact technical details (names, paths, commands, error messages) and cut chit-chat.

When I send "/resume <ID> <TOKEN>", call resume_handoff with them. When I paste a block between "=== SESSION HANDOFF ===" and "=== END ===", treat it as the saved context. After loading a handoff: treat it as a starting point; do not redo COMPLETED work; do not repeat FAILED ATTEMPTS; treat ASSUMPTIONS as unverified; say if anything looks missing or contradictory; then continue from NEXT ACTION. Ask me only if something blocks you.
```

## Use it

1. In the big chat, send `/newsession` (if typing `/` opens a menu, send `newsession`). Run it **before** the chat gets so long
   that Claude loses the early details.
2. Claude replies with one code block. Read it, remove anything private, and correct anything wrong. It is only as good as
   Claude's memory of the chat.
3. Open a new chat, paste the whole block and add: *"Continue from this handoff."* Claude resumes at NEXT ACTION without
   redoing finished work or repeating failed attempts.

With the optional Session Bridge connector enabled, step 2 returns a short ID and token instead, and step 3 is
`/resume hs_... sbt_...`.

## Limits

- It depends on Claude following your instructions: test once on a short throwaway chat first.
- Nothing is stored, expired, deleted or redacted for you: the block lives wherever you paste it. Keep secrets out of it.
- A handoff block costs tokens in the new chat (typically a small fraction of the old conversation); no savings are guaranteed.
