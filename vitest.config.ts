import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'apps/{chat-service,knowledge-service,llm-usage-service,user-service}/**/*.{test,spec}.{ts,tsx}',
            'packages/**/*.{test,spec}.{ts,tsx}',
            'migrations/**/*.{test,spec}.{ts,tsx}',
            'scripts/**/*.{test,spec}.{ts,tsx}',
          ],
          exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '.worktrees/**'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: ['apps/web/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '.worktrees/**'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['apps/**/src/**/*.{ts,tsx}', 'packages/**/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/*.d.ts',
        '**/__tests__/**',
        '**/testing/**',
        '**/index.ts',
        '**/main.tsx',
        '**/server.ts',
        '**/services.ts',
      ],
      thresholds: {
        lines: 90,
        branches: 83,
        functions: 95,
        statements: 90,
      },
    },
  },
});
