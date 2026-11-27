import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Unit tests run against core's source; the spawned reporter in snapshot tests uses core's build.
    alias: {
      '@suitemap/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['packages/*/src/**/*.test.ts'] },
});
