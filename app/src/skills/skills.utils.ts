import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  $SkillFrontmatter,
  SKILL_DOCUMENT_EXTENSION,
  SKILL_DOCUMENT_FILENAME,
  SKILL_NAME_PATTERN,
  SKILL_REFERENCES_DIRECTORY
} from '@collegium/core/skills';
import type { Skill, SkillReference } from '@collegium/core/skills';
import { parse as parseYaml } from 'yaml';

import type { PluginSkillSource } from '@/plugins/plugins.types.ts';

const FRONTMATTER_DELIMITER = '---';

function splitDocument(source: string): { body: string; frontmatter: string } {
  const lines = source.split('\n');
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    throw new Error(`expected the document to open with "${FRONTMATTER_DELIMITER}"`);
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === FRONTMATTER_DELIMITER);
  if (closingIndex === -1) {
    throw new Error(`expected the frontmatter to close with "${FRONTMATTER_DELIMITER}"`);
  }
  return {
    body: lines
      .slice(closingIndex + 1)
      .join('\n')
      .trim(),
    frontmatter: lines.slice(1, closingIndex).join('\n')
  };
}

function readDocument(filepath: string): SkillReference {
  const { body, frontmatter } = splitDocument(fs.readFileSync(filepath, 'utf-8'));
  if (!body) {
    throw new Error('expected a body beneath the frontmatter');
  }
  return { ...$SkillFrontmatter.parse(parseYaml(frontmatter)), body };
}

/**
 * A skill directory holds its procedure and its references and nothing else. A subdirectory beside
 * `references/` is the author's — evals, assets — exactly as a plugin's `src/tools/__tests__/` is,
 * but a stray file is refused: that is what catches `skill.md` written for `SKILL.md`.
 */
function assertNoStrayFiles(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && !entry.name.startsWith('.') && entry.name !== SKILL_DOCUMENT_FILENAME) {
      throw new Error(
        `"${entry.name}" is not part of a skill: a skill directory holds ${SKILL_DOCUMENT_FILENAME} and ${SKILL_REFERENCES_DIRECTORY}/`
      );
    }
  }
}

/**
 * The list and the directory are two artifacts §3.5 makes agree at boot: a skill on disk that no
 * list declares is loaded by nothing and absent from every manifest. A dotted name is the author's,
 * and skipped; a directory that does not exist declares nothing, and so contradicts nothing.
 */
function assertNoUndeclaredSkills(directory: string, names: readonly string[], listName: string): void {
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    return;
  }
  const declared = new Set<string>(names);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    if (!entry.isDirectory()) {
      throw new Error(`"${entry.name}" is not a skill: a skill library holds one directory per skill`);
    }
    if (!declared.has(entry.name)) {
      throw new Error(`"${entry.name}" is a skill directory no name list declares: add it to ${listName}`);
    }
  }
}

/** discovered, never declared: a reference name crosses no perimeter, so nothing needs its type (§3.5) */
function readReferences(directory: string): ReadonlyMap<string, SkillReference> {
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    return new Map();
  }
  const references = new Map<string, SkillReference>();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const located = `${SKILL_REFERENCES_DIRECTORY}/${entry.name}`;
    if (!entry.isFile()) {
      throw new Error(`"${located}" is not a reference: ${SKILL_REFERENCES_DIRECTORY}/ holds documents alone`);
    }
    const name = entry.name.slice(0, -SKILL_DOCUMENT_EXTENSION.length);
    if (!entry.name.endsWith(SKILL_DOCUMENT_EXTENSION) || name.includes('.') || name.length === 0) {
      throw new Error(
        `"${located}" is not a reference: every direct child of ${SKILL_REFERENCES_DIRECTORY}/ is one document named "<name>${SKILL_DOCUMENT_EXTENSION}" and carries no further extension`
      );
    }
    if (!SKILL_NAME_PATTERN.test(name)) {
      throw new Error(`"${located}" does not name a reference: the basename must be lowercase and dashed`);
    }
    references.set(name, readDocument(path.join(directory, entry.name)));
  }
  return references;
}

function readSkill(directory: string): Skill {
  try {
    if (!fs.statSync(path.join(directory, SKILL_DOCUMENT_FILENAME), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`expected a procedure document at "${SKILL_DOCUMENT_FILENAME}"`);
    }
    assertNoStrayFiles(directory);
    return {
      ...readDocument(path.join(directory, SKILL_DOCUMENT_FILENAME)),
      references: readReferences(path.join(directory, SKILL_REFERENCES_DIRECTORY))
    };
  } catch (error) {
    throw new Error(`invalid skill at "${directory}"`, { cause: error });
  }
}

/**
 * Read the directory declared for each name. Throws on a skill that is missing or unreadable: a
 * half-loaded library is worse than a refusal to start. Total by construction — every declared name
 * has an entry, so callers never handle an absent skill.
 */
export function loadSkillLibrary<const TName extends string>(
  directory: string,
  names: readonly TName[],
  listName: string
): { [TKey in TName]: Skill } {
  assertNoUndeclaredSkills(directory, names, listName);
  const entries = names.map((name) => [name, readSkill(path.join(directory, name))]);
  return Object.fromEntries(entries) as { [TKey in TName]: Skill };
}

/**
 * A plugin's declared skills, read here rather than by the plugin loader: one module owns reading a
 * skill off disk (§2). The refusal names the plugin, because that is what an operator must go and
 * fix (§3.14).
 */
export function loadPluginSkillLibrary(source: PluginSkillSource): { [name: string]: Skill } {
  try {
    return loadSkillLibrary(source.directory, source.names, `the ${source.namespace} plugin's declared skills`);
  } catch (error) {
    throw new Error(`plugin "${source.namespace}" declares a skill that could not be loaded`, {
      cause: error
    });
  }
}
