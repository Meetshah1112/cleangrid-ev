import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/server/**/*.test.ts', 'apps/simulator/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    environment: 'node',
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['packages/**/src/**/*.ts', 'apps/server/src/**/*.ts', 'apps/simulator/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/testkit.ts'],
      reporter: ['text', 'html'],
    },
  },
});
