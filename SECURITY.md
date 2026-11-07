# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities **privately**; do not open a public issue.

- Preferred: GitHub private vulnerability reporting (Security tab -> "Report a vulnerability") on this repository.
- Alternative: email `security@YOUR-DOMAIN.example` (**maintainer: replace this placeholder before publishing**).

Include affected version/commit, reproduction steps, impact, and any proof of concept. Never include real handoff
IDs or retrieval tokens. Maintainers should acknowledge reports promptly (target: a few business days), keep the
reporter informed, and credit them on request once a fix ships. Good-faith research that avoids harming other users'
data and respects rate limits is welcome.

## Scope

In scope: the API, memory engine, MCP server, skill, migrations and deployment configuration in this repository.
Out of scope: vulnerabilities in third-party dependencies (report upstream), hosting-provider issues, social
engineering, and denial of service through volumetric traffic.

## Design notes relevant to researchers

- Capability model: a handoff ID is public; access needs the separate 256-bit retrieval token. Only an HMAC of the
  token (keyed by `TOKEN_PEPPER`) is stored. Failed access never reveals whether a handoff exists.
- Rate limits are in memory and per instance. Invalid-credential limits are keyed by client IP.
- Secret redaction is best-effort pattern matching and **will miss secrets**. It is not a security boundary.
- Tokens shown in a conversation are as exposed as that conversation. The MCP server can keep them out of it
  (`SESSION_BRIDGE_REVEAL_TOKEN=false`); its optional local token file is plaintext, mode 0600.
- The hosted `/mcp` endpoint is open unless `MCP_ACCESS_TOKEN` is set (there are no accounts); each handoff is still
  protected by its own token, passed as a tool argument. Personal deployments should set the access key; operators may also
  restrict the endpoint to the IP ranges Anthropic publishes for Claude's connector traffic at their proxy.
- Logs never contain request bodies, `Authorization` headers or query strings.

## Operator checklist

Use https only (`REQUIRE_HTTPS`, correct `TRUST_PROXY`); set a unique random `TOKEN_PEPPER` and keep it in a secret
manager; restrict database network access; keep dependencies updated; monitor 429/5xx; never commit `.env`.
