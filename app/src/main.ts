import * as module from 'node:module';

if (import.meta.url.endsWith('.ts')) {
  module.register('@swc-node/register/esm', import.meta.url);
}

const { bootstrap } = await import('./bootstrap.ts');

await bootstrap();
