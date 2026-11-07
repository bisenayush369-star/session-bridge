/** Instructions delivered as MCP prompts so claude.ai (which has no /newsession skill) can start the same workflow. */
export const NEWSESSION_INSTRUCTIONS = `Save this conversation as a Session Bridge handoff so I can continue it in a fresh chat.

Rules:
- Use the create_handoff tool. If it is not available, say so and stop. Never pretend to save and never invent IDs or tokens.
- Record only what was actually established in this conversation. Put anything unverified in "assumptions".
- Never include secrets (API keys, passwords, tokens). Refer to them by name only.
- Fill: project{name,stack}, objective, requirements, decisions (with reasons), completed (specific), current_state (exact errors), failed_attempts [{attempt,result}], constraints, errors, open_questions, assumptions, relevant_files, and ONE concrete next_action. Omit retention unless I ask (the default is 30 days).
- After a success result, show me the handoff ID, the expiry, the retrieval token once (tell me to store it safely) and any warnings. If the tool fails, report the error.
- Finally tell me to start a new chat, enable this connector there, and say: "Resume Session Bridge handoff <ID> with token <TOKEN>".`;

export function resumeInstructions(handoffId: string, token: string): string {
  return `Resume Session Bridge handoff ${handoffId}.

Call resume_handoff with handoff_id "${handoffId}" and retrieval_token "${token}". If it fails (expired, revoked, not found, rate limited), report that and stop. Do not guess the content.
Then treat the result as a starting point: check it against what I tell you about the current state, do not redo completed work, do not repeat failed attempts, treat assumptions as unverified, say so if the result was truncated, and continue from the saved next action.`;
}
