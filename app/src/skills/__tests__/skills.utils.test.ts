import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSkillLibrary } from '../skills.utils.ts';

const VALID = ['---', 'description: How to work an inbox down to zero.', 'title: Daily triage', '---', '', 'The body.'];

let directory: string;

const write = (filename: string, lines: string[]): void => {
  fs.writeFileSync(path.join(directory, filename), lines.join('\n'));
};

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-skills-'));
});

afterEach(() => {
  fs.rmSync(directory, { force: true, recursive: true });
});

describe('loadSkillLibrary', () => {
  it('should key each declared name to its document', () => {
    write('daily-triage.md', VALID);
    expect(loadSkillLibrary(directory, ['daily-triage'])).toStrictEqual({
      'daily-triage': { body: 'The body.', description: 'How to work an inbox down to zero.', title: 'Daily triage' }
    });
  });

  it('should read a quoted value carrying a colon', () => {
    write('daily-triage.md', ['---', 'description: How to work.', 'title: "Triage: daily"', '---', 'The body.']);
    expect(loadSkillLibrary(directory, ['daily-triage'])['daily-triage'].title).toBe('Triage: daily');
  });

  it('should reject a declared name with no document', () => {
    expect(() => loadSkillLibrary(directory, ['daily-triage'])).toThrow(/daily-triage\.md/);
  });

  it('should reject a document with no frontmatter', () => {
    write('daily-triage.md', ['The body.']);
    expect(() => loadSkillLibrary(directory, ['daily-triage'])).toThrow(/daily-triage\.md/);
  });

  it('should reject a document whose frontmatter never closes', () => {
    write('daily-triage.md', ['---', 'description: How to work.', 'title: Daily triage']);
    expect(() => loadSkillLibrary(directory, ['daily-triage'])).toThrow(/daily-triage\.md/);
  });

  it('should reject a document missing a description', () => {
    write('daily-triage.md', ['---', 'title: Daily triage', '---', 'The body.']);
    expect(() => loadSkillLibrary(directory, ['daily-triage'])).toThrow(/daily-triage\.md/);
  });

  it('should reject a document whose frontmatter is not valid YAML', () => {
    write('daily-triage.md', ['---', 'title: [unclosed', '---', 'The body.']);
    expect(() => loadSkillLibrary(directory, ['daily-triage'])).toThrow(/daily-triage\.md/);
  });

  it('should reject a document with no body', () => {
    write('daily-triage.md', VALID.slice(0, 4));
    expect(() => loadSkillLibrary(directory, ['daily-triage'])).toThrow(/daily-triage\.md/);
  });
});
