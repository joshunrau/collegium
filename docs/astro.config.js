import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// Pages serves this as a project page, so the site lives under a path prefix rather than at the root
// of the origin. Starlight prefixes internal links from `base` itself.
export default defineConfig({
  base: '/collegium',
  integrations: [
    starlight({
      editLink: {
        baseUrl: 'https://github.com/joshunrau/collegium/edit/main/docs/'
      },
      sidebar: [
        { items: [{ autogenerate: { directory: 'getting-started' } }], label: 'Getting Started' },
        { items: [{ autogenerate: { directory: 'reference' } }], label: 'Reference' },
        { items: [{ autogenerate: { directory: 'plugins' } }], label: 'Plugins' }
      ],
      social: [{ href: 'https://github.com/joshunrau/collegium', icon: 'github', label: 'GitHub' }],
      title: 'Collegium'
    })
  ],
  site: 'https://joshunrau.github.io'
});
