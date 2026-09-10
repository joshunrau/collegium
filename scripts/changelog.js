/// <reference types="node" />

// @ts-check

/**
 * The changelog is one file with two readers. `increment-version.js` writes a section for the
 * version it just wrote, rendered from the conventional commits since the last release tag, and the
 * release workflow reads that section back as the GitHub release body.
 *
 * Run directly with a version, it prints that version's section without its heading, and exits
 * non-zero when the changelog holds no such section.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { ConventionalChangelog } from 'conventional-changelog';
import { format, resolveConfig } from 'prettier';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const CHANGELOG_PATH = path.join(ROOT_DIR, 'CHANGELOG.md');
const TAG_PREFIX = 'v';

// the types a reader sees; a commit of any other type is left out of the section
const VISIBLE_COMMIT_TYPES = [
  { section: 'Features', type: 'feat' },
  { section: 'Bug Fixes', type: 'fix' },
  { section: 'Performance', type: 'perf' },
  { section: 'Refactoring', type: 'refactor' },
  { section: 'Reverts', type: 'revert' }
];

const VERSION_HEADING = /^## \[?(?<version>[^\]\s]+)\]?/;

/** The section for the version the root manifest carries, rendered from the commits since the last release tag. */
async function renderReleaseSection() {
  const generator = new ConventionalChangelog(ROOT_DIR)
    .readPackage()
    .loadPreset({ name: 'conventionalcommits', types: VISIBLE_COMMIT_TYPES })
    .tags({ prefix: TAG_PREFIX });
  let section = '';
  for await (const chunk of generator.write()) {
    section += chunk;
  }
  return section.trim();
}

/**
 * Written already formatted: the release commit names its files by pathspec, so git commits from a
 * temporary index, and a reformat by the pre-commit hook would reach the commit but not the real
 * index or a clean working tree.
 * @param {string} section
 */
async function prependReleaseSection(section) {
  const existing = fs.existsSync(CHANGELOG_PATH) ? fs.readFileSync(CHANGELOG_PATH, 'utf-8').trim() : '';
  const contents = [section, existing].filter(Boolean).join('\n\n') + '\n';
  const options = await resolveConfig(CHANGELOG_PATH);
  fs.writeFileSync(CHANGELOG_PATH, await format(contents, { ...options, filepath: CHANGELOG_PATH }));
}

/**
 * The body of the named version's section — everything between its heading and the next version
 * heading — or null when the changelog holds no section for it.
 * @param {string} version
 * @returns {string | null}
 */
function readReleaseSection(version) {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    return null;
  }
  const lines = fs.readFileSync(CHANGELOG_PATH, 'utf-8').split('\n');
  const start = lines.findIndex((line) => VERSION_HEADING.exec(line)?.groups?.version === version);
  if (start === -1) {
    return null;
  }
  const end = lines.findIndex((line, index) => index > start && VERSION_HEADING.test(line));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

function main() {
  const version = process.argv[2];
  if (!version) {
    process.stderr.write('usage: node scripts/changelog.js <version>\n');
    process.exit(1);
  }
  const section = readReleaseSection(version);
  if (section === null) {
    process.stderr.write(`${path.relative(ROOT_DIR, CHANGELOG_PATH)} has no section for ${version}\n`);
    process.exit(1);
  }
  process.stdout.write(`${section}\n`);
}

if (process.argv[1] === import.meta.filename) {
  main();
}

export { CHANGELOG_PATH, prependReleaseSection, readReleaseSection, renderReleaseSection };
