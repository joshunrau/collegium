import * as module from 'node:module';

module.register('@swc-node/register/esm', import.meta.url);

const { isBrowserProvisioned } = await import('@/web/browser/browser.utils.ts');
const { CamoufoxFetcher } = await import('camoufox-js/dist/pkgman.js');

/**
 * Ensure-if-missing, never fatal: a failed download must not break `pnpm install` — the
 * real-browser tests fail with instructions until a rerun succeeds. Not `camoufoxPath(true)`,
 * whose download branch is fire-and-forget and cannot be awaited or caught. An unsupported
 * (outdated) installation also reads as unprovisioned, so upgrades land here too.
 */
if (!isBrowserProvisioned()) {
  try {
    await new CamoufoxFetcher().install();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`warning: Camoufox was not provisioned (${message}); rerun \`pnpm install\` to retry\n`);
  }
}
