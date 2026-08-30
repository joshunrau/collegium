import { defineConfig } from '@collegium/sdk';
import type { InferConfig } from '@collegium/sdk';

declare module '@collegium/sdk' {
  export interface Config extends InferConfig<typeof config> {}
}

const config = defineConfig(({ z }) => ({
  settings: z.object({
    foo: z.number()
  })
}));

export default config;
