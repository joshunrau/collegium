import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Tool } from '@collegium/core/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WriteFileTool } from '../write-file.tool.ts';

describe('WriteFileTool', () => {
  let outside: string;
  let workspace: string;

  const writeFileTool = new WriteFileTool();

  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-write-file-'));
    workspace = path.join(base, 'workspace');
    outside = path.join(base, 'outside');
    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(path.dirname(workspace), { force: true, recursive: true });
  });

  const execute = (args: { content: string; path: string }, root?: string) =>
    writeFileTool.execute(args, { workspaceDir: root ?? workspace } as Tool.TurnScope);

  describe('confinement (§6.1)', () => {
    it('should reject an absolute path', async () => {
      const result = await execute({ content: 'nope', path: '/etc/passwd' });
      expect(result.error).toStrictEqual({
        kind: 'invalid-arguments',
        message: '"/etc/passwd" is absolute; paths must be relative'
      });
    });

    it('should refuse traversal out of the workspace, writing nothing', async () => {
      const direct = await execute({ content: 'nope', path: '../outside/notes.md' });
      expect(direct.error).toMatchObject({ kind: 'invalid-arguments' });
      const buried = await execute({ content: 'nope', path: 'a/../../outside/notes.md' });
      expect(buried.error).toMatchObject({ kind: 'invalid-arguments' });
      expect(fs.readdirSync(outside)).toStrictEqual([]);
    });

    it('should refuse a symlinked target', async () => {
      fs.symlinkSync(path.join(outside, 'target.md'), path.join(workspace, 'link.md'));
      const result = await execute({ content: 'nope', path: 'link.md' });
      expect(result.error).toMatchObject({ kind: 'invalid-arguments' });
      expect(fs.existsSync(path.join(outside, 'target.md'))).toBe(false);
    });

    it('should refuse a path whose parent resolves outside the workspace', async () => {
      fs.symlinkSync(outside, path.join(workspace, 'escape'));
      const result = await execute({ content: 'nope', path: 'escape/notes.md' });
      expect(result.error).toMatchObject({ kind: 'invalid-arguments' });
      expect(fs.readdirSync(outside)).toStrictEqual([]);
    });

    it('should survive a symlinked workspace root', async () => {
      const linkedRoot = path.join(path.dirname(workspace), `root-link-${randomUUID()}`);
      fs.symlinkSync(workspace, linkedRoot);
      const result = await execute({ content: 'hello', path: 'notes.md' }, linkedRoot);
      expect(result.success).toBe(true);
      expect(fs.readFileSync(path.join(workspace, 'notes.md'), 'utf8')).toBe('hello');
    });
  });

  describe('execute', () => {
    it('should write the file, creating parent directories inside the workspace', async () => {
      const result = await execute({ content: 'hello', path: 'a/b/notes.md' });
      expect(result.success).toBe(true);
      expect(fs.readFileSync(path.join(workspace, 'a/b/notes.md'), 'utf8')).toBe('hello');
    });

    it('should leave no temp file behind after a completed write', async () => {
      await execute({ content: 'clean', path: 'notes.md' });
      expect(fs.readdirSync(workspace)).toStrictEqual(['notes.md']);
    });
  });

  describe('renderTraceDetail', () => {
    it('should trace the path and size, leaving the content to the approval payload', () => {
      expect(writeFileTool.renderTraceDetail({ content: 'line one\nline two', path: 'notes.md' })).toBe(
        'notes.md (17 bytes)'
      );
    });
  });

  describe('getApprovalRequirements', () => {
    it('should show the human the full content, not the intent (§6.2)', () => {
      expect(writeFileTool.variant).toBe('gated');
      expect(writeFileTool.getApprovalRequirements({ content: 'line one\nline two', path: 'notes.md' })).toStrictEqual({
        kind: 'gated',
        payload: { body: 'Write to `notes.md`:\n\n```\nline one\nline two\n```', presentation: 'collapse' }
      });
    });
  });
});
