// @ts-check

// A config file rather than the `prettier` field in package.json, because .astro files need
// prettier-plugin-astro registered and the field cannot pass options to the shared config.

import { createConfig } from '@douglasneuroinformatics/prettier-config';

export default createConfig({ astro: true, tailwindcss: true });
