# Copilot setup

Clone the repository (or download the ZIP) and open the folder in VS Code.

1. Install Node.js 22.12 or newer.
2. Run `npm install` in the repository root.
3. Run `npm run setup:env` to generate a local `.env` file from `.env.example`.
4. Start Postgres with `npm run db:up` or point `DATABASE_URL` at an external PostgreSQL instance.
5. Run `npm run db:generate` and `npm run db:migrate:deploy`.
6. Start the app with `npm run dev`.
