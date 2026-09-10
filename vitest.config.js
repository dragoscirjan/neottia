import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Workspace packages resolve to SOURCE in tests: dist builds must never be a
// precondition for running the suite. (The harness E2E tests still build dist
// explicitly — they spawn the compiled MCP server.)
const workspaceSourceAliases = {
  '@neottia/design-docs': resolve(__dirname, 'packages/design-docs/src/index.ts'),
  '@neottia/design-docs-mcp': resolve(__dirname, 'packages/design-docs-mcp/src/index.ts'),
  '@neottia/issues': resolve(__dirname, 'packages/issues/src/index.ts'),
  '@neottia/issues-mcp': resolve(__dirname, 'packages/issues-mcp/src/index.ts'),
  '@neottia/memory-core': resolve(__dirname, 'packages/memory-core/src/index.ts'),
  '@neottia/memory-mcp': resolve(__dirname, 'packages/memory-mcp/src/index.ts'),
  '@neottia/repository-store': resolve(__dirname, 'packages/repository-store/src/index.ts'),
  '@neottia/testkit': resolve(__dirname, 'packages/testkit/src/index.ts'),
};

export default defineConfig({
  resolve: {
    alias: workspaceSourceAliases,
  },
  server: {
    fs: {
      deny: ['.install', '.jscpd'],
    },
  },
  test: {
    coverage: {
      all: true,
      exclude: [
        '**/*.config.*',
        '**/.install/**',
        '**/.jscpd/**',
        '**/coverage/**',
        '**/dist/**',
        '**/node_modules/**',
        '**/src/**/*.spec.{js,ts}',
        '**/src/**/*.test.{js,ts}',
        '**/src/cli.{js,ts}',
      ],
      include: ['packages/*/src/**/*.ts', 'extensions/*/src/**/*.ts'],
      provider: 'v8',
      reporter: ['html', 'json', 'lcov', 'text'],
      reportsDirectory: './coverage',
      skipFull: false,
    },
    environment: 'node',
    exclude: ['**/*.config.*', '**/.install/**', '**/.jscpd/**', '**/coverage/**', '**/dist/**', '**/node_modules/**'],
    globals: true,
  },
});
