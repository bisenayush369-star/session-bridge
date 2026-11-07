import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@session-bridge/shared/schema': src('./packages/shared/src/schema.ts'),
      '@session-bridge/shared': src('./packages/shared/src/index.ts'),
      '@session-bridge/mcp-server': src('./packages/mcp-server/src/lib.ts'),
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
