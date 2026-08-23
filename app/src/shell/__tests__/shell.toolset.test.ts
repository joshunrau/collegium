import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';

import { ShellService } from '../shell.service.ts';
import { SHELL_TOOLSET } from '../shell.toolset.ts';

const { run } = SHELL_TOOLSET.tools;

function buildContext() {
  const shell = MockFactory.createMock(ShellService);
  const context = { shell, turn: buildToolTurnScope() };
  return { context, shell };
}

describe('SHELL_TOOLSET', () => {
  it('runs the command as the acting agent and returns its output', async () => {
    const { context, shell } = buildContext();
    shell.run.mockResolvedValue(Result.ok({ text: 'exit 0\nhello' }));
    const result = await executeTool(run, { command: 'echo hello' }, context);
    expect(shell.run).toHaveBeenCalledWith({ agentUsername: 'mira', command: 'echo hello' });
    expect(result.unwrap().text).toBe('exit 0\nhello');
  });

  it('reports a command that could not be launched as an exception', async () => {
    const { context, shell } = buildContext();
    shell.run.mockResolvedValue(Result.err({ message: 'sudo is missing' }));
    const result = await executeTool(run, { command: 'echo hello' }, context);
    expect(result.error).toStrictEqual({ kind: 'exception', message: 'sudo is missing' });
  });

  it('always gates, presenting the command verbatim and in full (§6.2)', () => {
    const payload = run.approval?.({ command: 'rm -rf ./scratch' });
    expect(payload).toStrictEqual({
      body: "Run this shell command as this agent's dedicated OS user:\n\n```sh\nrm -rf ./scratch\n```",
      presentation: 'verbatim'
    });
    expect(run.retryable).toBeUndefined();
    expect(run.traceDetail?.({ command: 'echo hello' })).toBe('echo hello');
  });
});
