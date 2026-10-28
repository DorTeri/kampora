import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx',
      'apps/api/src/**/*.test.ts',
      'apps/production-worker/src/**/*.test.ts',
    ],
    environment: 'node',
  },
});
