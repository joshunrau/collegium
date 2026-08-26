/// <reference types="node" />

// @ts-check

/**
 * The workspace packages released to npm: not private, and carrying a `publishConfig`. That marker
 * is the single source of truth — `increment-version.js` keeps their versions in step with the
 * root's and the release workflow publishes exactly this set, so adding one edits no list.
 *
 * Run directly, it prints one `<name>\t<version>\t<manifest path>` line per package.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** @returns {{ manifestPath: string; name: string; version: string }[]} */
function listPublishable() {
  /** @type {any[]} */
  const listed = JSON.parse(execFileSync('pnpm', ['ls', '-r', '--depth', '-1', '--json'], { encoding: 'utf-8' }));
  return listed
    .flatMap((/** @type {{ path: string }} */ entry) => {
      const manifestPath = path.join(entry.path, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (manifest.private === true || !manifest.publishConfig) {
        return [];
      }
      return [{ manifestPath, name: manifest.name, version: manifest.version }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  for (const { manifestPath, name, version } of listPublishable()) {
    process.stdout.write(`${name}\t${version}\t${manifestPath}\n`);
  }
}

if (process.argv[1] === import.meta.filename) {
  main();
}

export { listPublishable };
