import { defineConfig } from 'vitepress';

// Keep user-facing documentation configuration close to the Markdown content.
export default defineConfig({
  title: 'Neottia',
  description: 'A shared SDLC for AI coding harnesses',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [{ text: 'Guide', link: '/' }],
    search: {
      provider: 'local',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/dragoscirjan/neottia' }],
  },
});
