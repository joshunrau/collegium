import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadPluginSkillLibrary, loadSkillLibrary } from '../skills.utils.ts';

const VALID = ['---', 'description: How to work an inbox down to zero.', 'title: Daily triage', '---', '', 'The body.'];
const REFERENCE = ['---', 'description: Which folders to sweep.', 'title: Folder map', '---', 'The map.'];

let directory: string;

const write = (relativePath: string, lines: string[]): void => {
  const filepath = path.join(directory, relativePath);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, lines.join('\n'));
};

const load = (): ReturnType<typeof loadSkillLibrary<'daily-triage'>> => {
  return loadSkillLibrary(directory, ['daily-triage'], 'BUILTIN_SKILL_NAMES');
};

/** a refusal names the skill and states its reason one cause down, so the assertion reads the chain */
const refusal = (): string => {
  const messages: string[] = [];
  try {
    load();
  } catch (thrown) {
    for (let error: unknown = thrown; error instanceof Error; error = error.cause) {
      messages.push(error.message);
    }
  }
  return messages.join('\n');
};

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-skills-'));
});

afterEach(() => {
  fs.rmSync(directory, { force: true, recursive: true });
});

describe('loadSkillLibrary', () => {
  it('should key each declared name to its document', () => {
    write('daily-triage/SKILL.md', VALID);
    expect(load()).toStrictEqual({
      'daily-triage': {
        body: 'The body.',
        description: 'How to work an inbox down to zero.',
        references: new Map(),
        title: 'Daily triage'
      }
    });
  });

  it('should read a quoted value carrying a colon', () => {
    write('daily-triage/SKILL.md', ['---', 'description: How to work.', 'title: "Triage: daily"', '---', 'The body.']);
    expect(load()['daily-triage'].title).toBe('Triage: daily');
  });

  it('should reject a declared name with no directory', () => {
    expect(refusal()).toMatch(/daily-triage/);
  });

  it('should reject a directory with no procedure document', () => {
    write('daily-triage/references/folder-map.md', REFERENCE);
    expect(refusal()).toMatch(/SKILL\.md/);
  });

  it('should reject a document with no frontmatter', () => {
    write('daily-triage/SKILL.md', ['The body.']);
    expect(refusal()).toMatch(/daily-triage/);
  });

  it('should reject a document whose frontmatter never closes', () => {
    write('daily-triage/SKILL.md', ['---', 'description: How to work.', 'title: Daily triage']);
    expect(refusal()).toMatch(/daily-triage/);
  });

  it('should reject a document missing a description', () => {
    write('daily-triage/SKILL.md', ['---', 'title: Daily triage', '---', 'The body.']);
    expect(refusal()).toMatch(/daily-triage/);
  });

  it('should reject a document whose frontmatter is not valid YAML', () => {
    write('daily-triage/SKILL.md', ['---', 'title: [unclosed', '---', 'The body.']);
    expect(refusal()).toMatch(/daily-triage/);
  });

  it('should reject a document with no body', () => {
    write('daily-triage/SKILL.md', VALID.slice(0, 4));
    expect(refusal()).toMatch(/daily-triage/);
  });

  it('should reject a stray file beside the procedure document', () => {
    write('daily-triage/SKILL.md', VALID);
    write('daily-triage/NOTES.md', REFERENCE);
    expect(refusal()).toMatch(/"NOTES\.md" is not part of a skill/);
  });

  it('should ignore a subdirectory beside references/', () => {
    write('daily-triage/SKILL.md', VALID);
    write('daily-triage/evals/cases.md', REFERENCE);
    expect(load()['daily-triage'].references.size).toBe(0);
  });

  it('should reject a skill directory the name list does not declare (§3.5)', () => {
    write('daily-triage/SKILL.md', VALID);
    write('weekly-review/SKILL.md', VALID);
    expect(refusal()).toMatch(
      /"weekly-review" is a skill directory no name list declares: add it to BUILTIN_SKILL_NAMES/
    );
  });

  it('should ignore a dotted directory beside the declared skills', () => {
    write('daily-triage/SKILL.md', VALID);
    write('.draft-weekly-review/SKILL.md', VALID);
    expect(Object.keys(load())).toStrictEqual(['daily-triage']);
  });

  it('should reject a loose file beneath the library root', () => {
    write('daily-triage/SKILL.md', VALID);
    write('README.md', REFERENCE);
    expect(refusal()).toMatch(/"README\.md" is not a skill/);
  });

  it('should reject a skill directory when the list declares none at all (§3.5)', () => {
    write('daily-triage/SKILL.md', VALID);
    expect(() => loadSkillLibrary(directory, [], "the builtins toolset's skills list")).toThrow(
      /"daily-triage" is a skill directory no name list declares/
    );
  });
});

describe('loadSkillLibrary references', () => {
  beforeEach(() => {
    write('daily-triage/SKILL.md', VALID);
  });

  it('should key each reference by its basename', () => {
    write('daily-triage/references/folder-map.md', REFERENCE);
    expect(load()['daily-triage'].references.get('folder-map')).toStrictEqual({
      body: 'The map.',
      description: 'Which folders to sweep.',
      title: 'Folder map'
    });
  });

  it('should ignore a hidden file among the references', () => {
    write('daily-triage/references/folder-map.md', REFERENCE);
    write('daily-triage/references/.DS_Store', ['']);
    expect([...load()['daily-triage'].references.keys()]).toStrictEqual(['folder-map']);
  });

  it('should reject a reference that is not markdown', () => {
    write('daily-triage/references/notes.txt', REFERENCE);
    expect(refusal()).toMatch(/"references\/notes\.txt" is not a reference/);
  });

  it('should reject a reference carrying a compound extension', () => {
    write('daily-triage/references/folder-map.draft.md', REFERENCE);
    expect(refusal()).toMatch(/is not a reference/);
  });

  it('should reject a reference whose basename is outside the dashed grammar', () => {
    write('daily-triage/references/Folder_Map.md', REFERENCE);
    expect(refusal()).toMatch(/does not name a reference/);
  });

  it('should reject a subdirectory under references/', () => {
    write('daily-triage/references/archive/folder-map.md', REFERENCE);
    expect(refusal()).toMatch(/references\/ holds documents alone/);
  });

  it('should reject a reference whose frontmatter is refused', () => {
    write('daily-triage/references/folder-map.md', ['---', 'title: Folder map', '---', 'The map.']);
    expect(refusal()).toMatch(/daily-triage/);
  });
});

describe('loadPluginSkillLibrary', () => {
  it('should name the plugin when its directory holds an undeclared skill (§3.14)', () => {
    write('saving-bookmarks/SKILL.md', VALID);
    write('weekly-review/SKILL.md', VALID);
    expect(() => {
      return loadPluginSkillLibrary({ directory, names: ['saving-bookmarks'], namespace: 'bookmark' });
    }).toThrow('plugin "bookmark" declares a skill that could not be loaded');
  });
});
