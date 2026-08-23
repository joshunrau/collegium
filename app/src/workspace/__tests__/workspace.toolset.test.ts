import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';

import { WORKSPACE_TOOLSET } from '../workspace.toolset.ts';

const { write } = WORKSPACE_TOOLSET.tools;

describe('WORKSPACE_TOOLSET', () => {
  let outside: string;
  let workspace: string;

  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-workspace-'));
    workspace = path.join(base, 'workspace');
    outside = path.join(base, 'outside');
    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(path.dirname(workspace), { force: true, recursive: true });
  });

  const execute = (args: { content: string; path: string }, root?: string) => {
    const agents = MockFactory.createMock(AgentRegistry);
    agents.get.mockReturnValue({ workspaceDir: root ?? workspace } as never);
    return executeTool(write, args, { agents, turn: buildToolTurnScope() });
  };

  describe('confinement (§6.1)', () => {
    it('rejects an absolute path', async () => {
      const result = await execute({ content: 'nope', path: '/etc/passwd' });
      expect(result.error).toStrictEqual({
        kind: 'invalid-arguments',
        message: '"/etc/passwd" is absolute; paths must be relative'
      });
    });

    it('refuses traversal out of the workspace, writing nothing', async () => {
      const direct = await execute({ content: 'nope', path: '../outside/notes.md' });
      expect(direct.error).toMatchObject({ kind: 'invalid-arguments' });
      const buried = await execute({ content: 'nope', path: 'a/../../outside/notes.md' });
      expect(buried.error).toMatchObject({ kind: 'invalid-arguments' });
      expect(fs.readdirSync(outside)).toStrictEqual([]);
    });

    it('refuses a symlinked target', async () => {
      fs.symlinkSync(path.join(outside, 'target.md'), path.join(workspace, 'link.md'));
      const result = await execute({ content: 'nope', path: 'link.md' });
      expect(result.error).toMatchObject({ kind: 'invalid-arguments' });
      expect(fs.existsSync(path.join(outside, 'target.md'))).toBe(false);
    });

    it('refuses a path whose parent resolves outside the workspace', async () => {
      fs.symlinkSync(outside, path.join(workspace, 'escape'));
      const result = await execute({ content: 'nope', path: 'escape/notes.md' });
      expect(result.error).toMatchObject({ kind: 'invalid-arguments' });
      expect(fs.readdirSync(outside)).toStrictEqual([]);
    });

    it('survives a symlinked workspace root', async () => {
      const linkedRoot = path.join(path.dirname(workspace), `root-link-${randomUUID()}`);
      fs.symlinkSync(workspace, linkedRoot);
      const result = await execute({ content: 'hello', path: 'notes.md' }, linkedRoot);
      expect(result.success).toBe(true);
      expect(fs.readFileSync(path.join(workspace, 'notes.md'), 'utf8')).toBe('hello');
    });
  });

  describe('write', () => {
    it('writes the file, creating parent directories inside the workspace', async () => {
      const result = await execute({ content: 'hello', path: 'a/b/notes.md' });
      expect(result.success).toBe(true);
      expect(fs.readFileSync(path.join(workspace, 'a/b/notes.md'), 'utf8')).toBe('hello');
    });

    it('leaves no temp file behind after a completed write', async () => {
      await execute({ content: 'clean', path: 'notes.md' });
      expect(fs.readdirSync(workspace)).toStrictEqual(['notes.md']);
    });

    it('fails with an exception for an agent the registry does not hold', async () => {
      const agents = MockFactory.createMock(AgentRegistry);
      agents.get.mockReturnValue(undefined);
      const result = await executeTool(
        write,
        { content: 'x', path: 'notes.md' },
        { agents, turn: buildToolTurnScope() }
      );
      expect(result.error).toStrictEqual({ kind: 'exception', message: 'no agent is registered as "mira"' });
    });
  });

  describe('approval and trace', () => {
    it('always gates, showing the human the full content, not the intent (§6.2)', () => {
      expect(write.approval?.({ content: 'line one\nline two', path: 'notes.md' })).toStrictEqual({
        body: 'Write to `notes.md`:\n\n```\nline one\nline two\n```',
        presentation: 'collapse'
      });
    });

    it('traces the path and size, leaving the content to the approval payload', () => {
      expect(write.traceDetail?.({ content: 'line one\nline two', path: 'notes.md' })).toBe('notes.md (17 bytes)');
    });
  });
});
