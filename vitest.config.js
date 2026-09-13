import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Vitest resolves workspace packages to source. The root test still builds
// dist because Bun and child-process suites execute package entry points.
const workspaceSourceAliases = {
  '@neottia/config': resolve(__dirname, 'packages/config/src/index.ts'),
  '@neottia/config-registry': resolve(__dirname, 'packages/config-registry/src/index.ts'),
  '@neottia/design-docs': resolve(__dirname, 'packages/design-docs/src/index.ts'),
  '@neottia/design-docs-mcp': resolve(__dirname, 'packages/design-docs-mcp/src/index.ts'),
  '@neottia/issues': resolve(__dirname, 'packages/issues/src/index.ts'),
  '@neottia/issues-design-docs': resolve(__dirname, 'packages/issues-design-docs/src/index.ts'),
  '@neottia/issues-mcp': resolve(__dirname, 'packages/issues-mcp/src/index.ts'),
  '@neottia/memory-core': resolve(__dirname, 'packages/memory-core/src/index.ts'),
  '@neottia/memory-mcp': resolve(__dirname, 'packages/memory-mcp/src/index.ts'),
  '@neottia/repository-store': resolve(__dirname, 'packages/repository-store/src/index.ts'),
  '@neottia/searchable-core': resolve(__dirname, 'packages/searchable-core/src/index.ts'),
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
      // Vitest 4 covers unloaded files through the explicit include pattern.
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
    exclude: [
      '**/*.bun.test.ts', // Bun-only suites run through their package scripts.
      '**/*.config.*',
      '**/.install/**',
      '**/.jscpd/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
    ],
    globals: true,
  },
});
