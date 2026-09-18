import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { READ_CAP_CHARS, WALK_MAX_ENTRIES } from '../../workspace.constants.ts';
import { findEntries, grepFiles, listDirectory, readLines, statEntry } from '../reads.utils.ts';

import type { ResolvedPath } from '../reads.utils.ts';

describe('workspace reads', () => {
  let root: string;

  const at = (relative: string): ResolvedPath => ({ absolute: path.join(root, relative), relative });

  const write = (relative: string, content: Buffer | string) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-reads-'));
  });

  afterEach(() => {
    fs.rmSync(root, { force: true, recursive: true });
  });

  describe('listDirectory', () => {
    it('should hide dotted names unless asked for them', async () => {
      write('notes.md', 'hello');
      write('.hidden', 'x');
      expect(await listDirectory(at('.'), { all: false })).toBe('notes.md (5 bytes)');
      expect(await listDirectory(at('.'), { all: true })).toBe('.hidden (1 bytes)\nnotes.md (5 bytes)');
    });

    it('should report a missing directory as text rather than throwing', async () => {
      expect(await listDirectory(at('absent'), { all: false })).toBe('absent: no such file or directory');
    });
  });

  describe('readLines', () => {
    it('should read a whole file', async () => {
      write('notes.md', 'one\ntwo\nthree');
      expect(await readLines(at('notes.md'), {})).toStrictEqual({ bytes: 13, text: 'one\ntwo\nthree' });
    });

    it('should read a line range inclusively', async () => {
      write('notes.md', 'one\ntwo\nthree\nfour');
      expect((await readLines(at('notes.md'), { endLine: 3, startLine: 2 })).text).toBe('two\nthree');
      expect((await readLines(at('notes.md'), { startLine: 3 })).text).toBe('three\nfour');
    });

    it('should cut a long file at the cap with a visible marker', async () => {
      write('big.txt', 'x'.repeat(READ_CAP_CHARS + 10));
      const { text } = await readLines(at('big.txt'), {});
      expect(text.endsWith(`\n…truncated at ${READ_CAP_CHARS} characters`)).toBe(true);
    });

    it('should report a missing file as text rather than throwing', async () => {
      expect(await readLines(at('absent.md'), {})).toStrictEqual({
        bytes: 0,
        text: 'absent.md: no such file or directory'
      });
    });
  });

  describe('findEntries', () => {
    it('should match a glob within the depth and no deeper', async () => {
      write('logs/app.log', 'x');
      write('logs/deep/old.log', 'x');
      expect(await findEntries(at('.'), { maxDepth: 4, namePattern: '*.log' })).toBe('logs/app.log\nlogs/deep/old.log');
      expect(await findEntries(at('.'), { maxDepth: 2, namePattern: '*.log' })).toBe('logs/app.log');
    });

    it('should not descend a symbolic link', async () => {
      write('real/target.log', 'x');
      fs.symlinkSync(path.join(root, 'real'), path.join(root, 'link'));
      expect(await findEntries(at('.'), { maxDepth: 4, namePattern: '*.log' })).toBe('real/target.log');
    });

    it('should stop a walk at the entry cap and say so', async () => {
      for (let index = 0; index <= WALK_MAX_ENTRIES; index += 1) {
        write(`many/file-${index}.log`, 'x');
      }
      const found = await findEntries(at('many'), { maxDepth: 4, namePattern: '*.log' });
      expect(found.endsWith(`…walk stopped after ${WALK_MAX_ENTRIES} entries`)).toBe(true);
    });
  });

  describe('grepFiles', () => {
    it('should report matching lines up to the per-file cap', async () => {
      write('logs/app.log', 'ok\nERROR one\nERROR two');
      expect(await grepFiles(at('.'), { maxMatches: 20, pattern: /ERROR/u })).toBe(
        'logs/app.log:2:ERROR one\nlogs/app.log:3:ERROR two'
      );
      expect(await grepFiles(at('.'), { maxMatches: 1, pattern: /ERROR/u })).toBe('logs/app.log:2:ERROR one');
    });

    it('should skip a symbolic link rather than read through it', async () => {
      write('real/target.log', 'ERROR here');
      fs.symlinkSync(path.join(root, 'real/target.log'), path.join(root, 'link.log'));
      expect(await grepFiles(at('.'), { maxMatches: 20, pattern: /ERROR/u })).toBe('real/target.log:1:ERROR here');
      expect(await grepFiles(at('link.log'), { maxMatches: 20, pattern: /ERROR/u })).toBe(
        'link.log: is a symbolic link, which the workspace does not follow'
      );
    });

    it('should stop a pattern that runs past its budget rather than stall the process', async () => {
      write('notes.md', `${'a'.repeat(40)}!`);
      expect(await grepFiles(at('.'), { maxMatches: 20, pattern: /^(a+)+$/u })).toBe(
        '.: the pattern took longer than 2000ms to run and was stopped'
      );
    }, 10_000);

    it('should skip a binary file', async () => {
      write('image.bin', Buffer.from([0x45, 0x00, 0x52]));
      expect(await grepFiles(at('.'), { maxMatches: 20, pattern: /E/u })).toBe('.: nothing matches the pattern');
    });
  });

  describe('statEntry', () => {
    it('should name the kind and size of a file and of a directory', async () => {
      write('logs/app.log', 'hello');
      expect(await statEntry(at('logs/app.log'))).toMatch(/^logs\/app\.log: file, 5 bytes, modified /u);
      expect(await statEntry(at('logs'))).toMatch(/^logs: directory, \d+ bytes, modified /u);
    });
  });
});
