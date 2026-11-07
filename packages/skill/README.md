# /newsession skill (Claude Code)

`newsession/SKILL.md` is a Claude Code skill. The directory name is the slash command, so keep it `newsession`.

Install (personal, all projects):

```bash
mkdir -p ~/.claude/skills && cp -r packages/skill/newsession ~/.claude/skills/
```

Install (one project, committed with the repo):

```bash
mkdir -p .claude/skills && cp -r packages/skill/newsession .claude/skills/
```

The skill only drives the `session-bridge` MCP tools; it cannot make HTTP requests on its own. Set up the MCP
server first (see `docs/integrations/claude-code.md`). The skill deliberately does not pre-approve any tools
(`allowed-tools`), so Claude Code asks before project memory is sent to the API.
