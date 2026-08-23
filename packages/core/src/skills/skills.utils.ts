import * as fs from 'node:fs';
import * as path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { $SkillFrontmatter } from './skills.schemas.ts';

import type { Skill } from './skills.types.ts';

const FRONTMATTER_DELIMITER = '---';
const SKILL_FILE_EXTENSION = '.md';

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

function parseSkill(source: string): Skill {
  const { body, frontmatter } = splitDocument(source);
  if (!body) {
    throw new Error('expected a body beneath the frontmatter');
  }
  return { ...$SkillFrontmatter.parse(parseYaml(frontmatter)), body };
}

function readSkill(filepath: string): Skill {
  try {
    return parseSkill(fs.readFileSync(filepath, 'utf-8'));
  } catch (error) {
    throw new Error(`invalid skill document at "${filepath}"`, { cause: error });
  }
}

/** the qualified name a toolset-shipped skill is granted and loaded by (§9) */
export function renderQualifiedSkillName(namespace: string, skillName: string): string {
  return `${namespace}::${skillName}`;
}

/**
 * Read the document declared for each name. Throws on a document that is missing or unreadable: a
 * half-loaded library is worse than a refusal to start. Total by construction — every declared name
 * has an entry, so callers never handle an absent skill.
 */
export function loadSkillLibrary<const TName extends string>(
  directory: string,
  names: readonly TName[]
): { [TKey in TName]: Skill } {
  const entries = names.map((name) => [name, readSkill(path.join(directory, `${name}${SKILL_FILE_EXTENSION}`))]);
  return Object.fromEntries(entries) as { [TKey in TName]: Skill };
}
