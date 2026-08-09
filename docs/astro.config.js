import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
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
  site: 'https://collegium.sh'
});
