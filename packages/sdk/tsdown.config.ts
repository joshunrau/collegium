import { defineConfig } from 'tsdown';

// `@collegium/core` is a devDependency so that it is bundled rather than externalised: the SDK is
// the surface a plugin may depend on, and core must stay refactorable behind it (§3.14).
export default defineConfig({
  dts: { eager: true },
  entry: {
    index: 'src/index.ts',
    testing: 'src/testing.ts'
  },
  fixedExtension: false,
  format: 'esm',
  outDir: 'dist',
  platform: 'node',
  treeshake: true
});
