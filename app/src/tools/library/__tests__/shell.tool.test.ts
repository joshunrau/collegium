import type { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ShellService } from '@/shell/shell.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ShellTool } from '../shell.tool.ts';

const turn = { agentUsername: 'mira', turnId: 'turn-1' } as Tool.TurnScope;

describe('ShellTool', () => {
  let shell: MockedInstance<ShellService>;
  let tool: ShellTool;

  beforeEach(async () => {
    shell = MockFactory.createMock(ShellService);
    const moduleRef = await Test.createTestingModule({
      providers: [ShellTool, { provide: ShellService, useValue: shell }]
    }).compile();
    tool = moduleRef.get(ShellTool);
  });

  it('should run the command under the agent of the turn, never one named by the model', async () => {
    shell.run.mockResolvedValue(Result.ok({ text: 'exit code: 0\n\nstdout:\nmira' }));
    const result = await tool.execute({ command: 'id -un' }, turn);
    expect(shell.run).toHaveBeenCalledWith({ agentUsername: 'mira', command: 'id -un' });
    expect(result.success && result.value.text).toContain('stdout:\nmira');
  });

  it('should terminate the turn as an exception when the dedicated user could not launch the command', async () => {
    shell.run.mockResolvedValue(Result.err({ message: 'the shell command could not be launched: spawn sudo ENOENT' }));
    const result = await tool.execute({ command: 'id -un' }, turn);
    expect(result.error).toMatchObject({ kind: 'exception' });
  });

  it('should present the command inline and in full, verbatim, for approval (§6.2)', () => {
    expect(tool.variant).toBe('gated');
    expect(tool.getApprovalRequirements({ command: 'rm -rf /tmp/scratch' })).toStrictEqual({
      kind: 'gated',
      payload: {
        body: "Run this shell command as this agent's dedicated OS user:\n\n```sh\nrm -rf /tmp/scratch\n```",
        presentation: 'verbatim'
      }
    });
  });
});
