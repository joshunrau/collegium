/// <reference types="node" />

// @ts-check

/**
 * Move the root version and every publishable package to the same new version. The SDK is released
 * with the framework and carries its version, because the range a plugin declares names the
 * deployment it was written for (§3.14) — two version lines would make that range mean nothing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';

import { inc, valid } from 'semver';

import { listPublishable } from './list-publishable.js';

const ROOT_MANIFEST = path.resolve(import.meta.dirname, '..', 'package.json');

/** @type {import('semver').ReleaseType[]} */
const RELEASES = ['prerelease', 'patch', 'minor', 'major'];

// naming the identifier is what keeps a prerelease bump inside the release tag grammar CI matches:
// without it semver produces `0.0.2-0`, which is valid semver and not a version this project ships
const PRERELEASE_IDENTIFIER = 'beta';

/** @param {string} message */
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const currentVersion = JSON.parse(fs.readFileSync(ROOT_MANIFEST, 'utf-8')).version;
if (!valid(currentVersion)) {
  fail(`the root version "${currentVersion}" is not a valid semantic version`);
}

const choices = RELEASES.map((release) => {
  const version = inc(currentVersion, release, PRERELEASE_IDENTIFIER);
  if (!version) {
    fail(`cannot apply a ${release} release to "${currentVersion}"`);
  }
  return { release, version: /** @type {string} */ (version) };
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// a closed input — Ctrl-D, Ctrl-C, a pipe running dry — leaves every pending question unsettled,
// so the process would hang holding an unbumped tree rather than say it is doing nothing
let answered = false;
rl.on('close', () => {
  if (!answered) {
    process.stdout.write('\nAborted.\n');
    process.exit(0);
  }
});

process.stdout.write(`Current version: ${currentVersion}\n\n`);
for (const [index, { release, version }] of choices.entries()) {
  process.stdout.write(`  ${index + 1}) ${release.padEnd(11)} ${version}\n`);
}
process.stdout.write(`  ${choices.length + 1}) quit\n\n`);

let selected;
while (!selected) {
  const answer = await rl.question('Select a version bump: ');
  if (answer.trim() === String(choices.length + 1)) {
    answered = true;
    rl.close();
    process.stdout.write('Aborted.\n');
    process.exit(0);
  }
  selected = choices[Number(answer.trim()) - 1];
  if (!selected) {
    process.stdout.write('Invalid selection.\n');
  }
}

const confirmation = await rl.question(`Bump ${currentVersion} -> ${selected.version}? [y/N] `);
answered = true;
rl.close();
if (!/^y(es)?$/i.test(confirmation.trim())) {
  process.stdout.write('Aborted.\n');
  process.exit(0);
}

for (const manifestPath of [ROOT_MANIFEST, ...listPublishable().map((entry) => entry.manifestPath)]) {
  const contents = fs.readFileSync(manifestPath, 'utf-8');
  const updated = contents.replace(/("version":\s*)"[^"]*"/, `$1"${selected.version}"`);
  if (updated === contents) {
    fail(`no version field was updated in ${manifestPath}`);
  }
  fs.writeFileSync(manifestPath, updated);
  process.stdout.write(`${path.relative(path.dirname(ROOT_MANIFEST), manifestPath)} -> ${selected.version}\n`);
}
