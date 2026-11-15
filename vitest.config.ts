/**
 * @purpose Vitest configuration for the root monorepo test runner and CI quality gates.
 * @rationale Configures single-engine test execution across all packages and QG suites.
 * @preconditions Vitest 3.x installed with TypeScript support.
 * @param None
 * @returns {import('vitest/config').UserConfig} Validated Vitest configuration.
 * @throws Never
 * @invariants Pure configuration object; zero mutation of runtime environment.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shukoi/core/testing': path.resolve(__dirname, './packages/core/src/testing/index.ts'),
      '@shukoi/core': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@shukoi/api': path.resolve(__dirname, './packages/api/src/index.ts'),
      '@shukoi/mcp/http': path.resolve(__dirname, './packages/mcp/src/http.ts'),
      '@shukoi/mcp/stdio': path.resolve(__dirname, './packages/mcp/src/stdio.ts'),
      '@shukoi/mcp': path.resolve(__dirname, './packages/mcp/src/shared.ts'),
      '@shukoi/cloudflare': path.resolve(__dirname, './packages/cloudflare/src/index.ts'),
      '@shukoi/lambda': path.resolve(__dirname, './packages/lambda/src/index.ts'),
      '@shukoi/selfhost': path.resolve(__dirname, './packages/selfhost/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
