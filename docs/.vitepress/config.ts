import { defineConfig } from 'vitepress';

// Diátaxis (diataxis.fr): four strictly separated documentation types —
// Tutorials (learning), How-to guides (tasks), Reference (facts), Explanation (why).
export default defineConfig({
  title: 'Cartography',
  description: 'MCP-first infrastructure & agentic-AI cartography',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  // tasks.md is an internal build checklist, not documentation.
  srcExclude: ['tasks.md'],
  themeConfig: {
    nav: [
      { text: 'Tutorials', link: '/tutorials/' },
      { text: 'How-to', link: '/how-to/' },
      { text: 'Reference', link: '/reference/' },
      { text: 'Explanation', link: '/explanation/' },
    ],
    sidebar: {
      '/tutorials/': [{ text: 'Tutorials', items: [{ text: 'Get started', link: '/tutorials/' }] }],
      '/how-to/': [
        {
          text: 'How-to guides',
          items: [
            { text: 'Overview', link: '/how-to/' },
            { text: 'Install into a client', link: '/how-to/install' },
            { text: 'Use non-MCP frameworks', link: '/adapters' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Overview', link: '/reference/' },
            { text: 'MCP tools & resources', link: '/reference/mcp' },
            { text: 'CLI', link: '/reference/cli' },
            { text: 'Supported clients', link: '/reference/clients' },
          ],
        },
      ],
      '/explanation/': [{ text: 'Explanation', items: [{ text: 'Why MCP-first', link: '/explanation/' }] }],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/datasynx/agentic-ai-cartography' }],
    search: { provider: 'local' },
  },
});
