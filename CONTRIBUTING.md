# Contributing

Thanks for helping. Keep changes small, tested and dependency-light.

## Setup

```bash
cp .env.example .env && npm install && npm run db:up && npm run db:generate && npm run db:migrate:deploy
npm test && npm run typecheck && npm run lint && npm run format:check
```

Node >= 22.12. TypeScript is strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`): use `import type` and
`.js` extensions in relative imports.

## Ground rules

- Add or update tests with every behaviour change (Vitest; inject a clock instead of fake timers).
- Core logic (memory, redaction, credentials, retention, limiting, service) stays free of framework dependencies so
  it is unit-testable; keep Fastify/Prisma/MCP-SDK code thin.
- New dependencies need a concrete justification in the PR. No Redis, vector DB or LLM calls unless a requirement
  demands it. Storing and retrieving memory must never call an LLM.
- Never log or return secrets, tokens, `Authorization` headers or request bodies. Error messages must not reveal
  whether a handoff exists.
- Do not claim a feature works unless it is implemented and tested; document limitations in the README.
- Security-sensitive areas (credentials, authorization, rate limiting, redaction, migrations) need a maintainer
  review. Report vulnerabilities privately (see SECURITY.md).
- Schema changes: `npm run db:migrate:dev -- --name <change>`, commit the SQL, and describe the rollout.

## License

By contributing you agree your contribution is licensed under the project's MIT license.
