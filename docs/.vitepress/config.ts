import { defineConfig } from 'vitepress';

// Navigation groups follow user tasks rather than workspace layout.
export default defineConfig({
  title: 'Neottia',
  description: 'A shared SDLC for AI coding harnesses',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Get started', link: '/get-started/' },
      {
        text: 'Features',
        items: [
          { text: 'Memory', link: '/memory/' },
          { text: 'Issues', link: '/issues/' },
          { text: 'Design Docs', link: '/design-docs/' },
          { text: 'Searchable', link: '/searchable/' },
        ],
      },
      {
        text: 'Harnesses',
        items: [
          { text: 'Overview', link: '/harnesses/' },
          { text: 'Pi', link: '/harnesses/pi' },
          { text: 'OpenCode', link: '/harnesses/opencode' },
        ],
      },
      {
        text: 'MCP',
        items: [
          { text: 'Overview', link: '/mcp/' },
          { text: 'Memory', link: '/mcp/memory' },
          { text: 'Issues', link: '/mcp/issues' },
          { text: 'Design Docs', link: '/mcp/design-docs' },
        ],
      },
      { text: 'Guides', link: '/guides/' },
      {
        text: 'Reference',
        items: [
          { text: 'Modules', link: '/reference/modules' },
          { text: 'Core', link: '/reference/core' },
          { text: 'Repository Store', link: '/repository-store' },
          { text: 'Release', link: '/reference/release' },
        ],
      },
    ],
    sidebar: {
      '/get-started/': [
        {
          text: 'Get started',
          items: [
            { text: 'Choose a delivery method', link: '/get-started/' },
            { text: 'Requirements', link: '/get-started/requirements' },
            { text: 'Configuration', link: '/get-started/configuration' },
            { text: 'First success', link: '/get-started/first-success' },
          ],
        },
      ],
      '/harnesses/': [
        {
          text: 'Harnesses',
          items: [
            { text: 'Overview', link: '/harnesses/' },
            { text: 'Pi', link: '/harnesses/pi' },
            { text: 'OpenCode', link: '/harnesses/opencode' },
          ],
        },
      ],
      '/mcp/': [
        {
          text: 'MCP',
          items: [
            { text: 'Overview', link: '/mcp/' },
            { text: 'Memory', link: '/mcp/memory' },
            { text: 'Issues', link: '/mcp/issues' },
            { text: 'Design Docs', link: '/mcp/design-docs' },
          ],
        },
      ],
      '/memory/': [
        {
          text: 'Memory',
          items: [
            { text: 'Overview', link: '/memory/' },
            { text: 'Configuration', link: '/memory/configuration' },
            { text: 'Records', link: '/memory/records' },
            { text: 'Backends', link: '/memory/backends' },
            { text: 'Library', link: '/memory/library' },
            { text: 'Tools', link: '/memory/tools' },
            { text: 'Import and export', link: '/memory/import-export' },
            { text: 'Operations', link: '/memory/operations' },
            { text: 'MCP compatibility route', link: '/memory/mcp-server' },
          ],
        },
      ],
      '/issues/': [
        {
          text: 'Issues',
          items: [
            { text: 'Overview', link: '/issues/' },
            { text: 'Configuration', link: '/issues/configuration' },
            { text: 'Canonical format', link: '/issues/canonical-format' },
            { text: 'Lifecycle', link: '/issues/lifecycle' },
            { text: 'Relationships', link: '/issues/relationships' },
            { text: 'Library', link: '/issues/library' },
            { text: 'Tools', link: '/issues/tools' },
            { text: 'Design Docs', link: '/issues/design-docs' },
            { text: 'Migration', link: '/issues/migration' },
            { text: 'Operations', link: '/issues/operations' },
          ],
        },
      ],
      '/design-docs/': [
        {
          text: 'Design Docs',
          items: [
            { text: 'Overview', link: '/design-docs/' },
            { text: 'Configuration', link: '/design-docs/configuration' },
            { text: 'Canonical format', link: '/design-docs/canonical-format' },
            { text: 'Lifecycle', link: '/design-docs/lifecycle' },
            { text: 'Library', link: '/design-docs/library' },
            { text: 'Tools', link: '/design-docs/tools' },
            { text: 'Issue links', link: '/design-docs/issue-links' },
            { text: 'Migration', link: '/design-docs/migration' },
            { text: 'Operations', link: '/design-docs/operations' },
          ],
        },
      ],
      '/searchable/': [
        {
          text: 'Searchable',
          items: [
            { text: 'Foundation status', link: '/searchable/' },
            { text: 'Configuration', link: '/searchable/configuration' },
            { text: 'Services', link: '/searchable/services' },
            { text: 'Tools', link: '/searchable/tools' },
            { text: 'Security', link: '/searchable/security' },
          ],
        },
      ],
      '/guides/': [
        {
          text: 'Guides',
          items: [
            { text: 'Overview', link: '/guides/' },
            { text: 'Repository files', link: '/guides/repository-files' },
            { text: 'Issue, design, and memory workflow', link: '/guides/issue-design-memory-workflow' },
            { text: 'Backup and migration', link: '/guides/backup-and-migration' },
            { text: 'Upgrades and recovery', link: '/guides/upgrades-and-recovery' },
            { text: 'Security and errors', link: '/guides/security-and-errors' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Modules', link: '/reference/modules' },
            { text: 'Core', link: '/reference/core' },
            { text: 'Release metadata', link: '/reference/release' },
          ],
        },
      ],
    },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/dragoscirjan/neottia' }],
  },
});
