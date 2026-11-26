import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://events.livelovelascruces.com',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [sitemap({
    filter: (page) => !page.includes('/404') && !page.includes('/more/')
      // Dated pages of a repeating series: their series page is listed instead (src/lib/events.js).
      && !(globalThis.__lcNotInSitemap?.has(new URL(page).pathname)),
  })],
});
