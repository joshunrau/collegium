import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import type { ToolName } from '@/tools/tools.types.ts';

import { ProcessRunner } from '../runners/process.runner.ts';
import { ShellService } from '../shell.service.ts';

const profile = (username: string, tools: readonly ToolName[]): AgentProfile => ({ tools, username }) as AgentProfile;

describe('ShellService', () => {
  let processRunner: MockedInstance<ProcessRunner>;
  let shellService: ShellService;

  beforeEach(async () => {
    processRunner = MockFactory.createMock(ProcessRunner);
    const moduleRef = await Test.createTestingModule({
      providers: [ShellService, { provide: ProcessRunner, useValue: processRunner }]
    }).compile();
    shellService = moduleRef.get(ShellService);
  });

  describe('run', () => {
    it('should run the command as the agent’s derived OS user and return the formatted output', async () => {
      processRunner.spawnCaptured.mockResolvedValue(Result.ok({ code: 0, signal: null, stderr: '', stdout: 'mira' }));
      const result = await shellService.run({ agentUsername: 'mira', command: 'id -un' });
      const [file, args] = processRunner.spawnCaptured.mock.calls[0]!;
      expect(file).toBe('sudo');
      expect(args).toContain('collegium-mira');
      expect(args.at(-1)).toBe('id -un');
      expect(result.success && result.value.text).toBe('exit code: 0\n\nstdout:\nmira');
    });

    it('should surface a launch failure as an error, since a command that never started told us nothing', async () => {
      processRunner.spawnCaptured.mockResolvedValue(Result.err({ message: 'spawn sudo ENOENT' }));
      const result = await shellService.run({ agentUsername: 'mira', command: 'id -un' });
      expect(!result.success && result.error.message).toContain('could not be launched');
    });
  });

  describe('assertProvisioned', () => {
    it('should never probe when no agent holds the shell tool (dev and e2e stay untouched)', async () => {
      await shellService.assertProvisioned([profile('mira', []), profile('tess', ['write_file'])]);
      expect(processRunner.spawnCaptured).not.toHaveBeenCalled();
    });

    it('should pass when a shell-holding agent’s OS user is assumable', async () => {
      processRunner.spawnCaptured.mockResolvedValue(Result.ok({ code: 0, signal: null, stderr: '', stdout: '' }));
      await expect(shellService.assertProvisioned([profile('mira', ['shell'])])).resolves.toBeUndefined();
    });

    it('should stop boot loudly when sudo cannot be launched at all', async () => {
      processRunner.spawnCaptured.mockResolvedValue(Result.err({ message: 'spawn sudo ENOENT' }));
      await expect(shellService.assertProvisioned([profile('mira', ['shell'])])).rejects.toThrow(/mira.*unusable/s);
    });

    it('should stop boot loudly when the OS user cannot be assumed', async () => {
      processRunner.spawnCaptured.mockResolvedValue(
        Result.ok({ code: 1, signal: null, stderr: 'sudo: a password is required', stdout: '' })
      );
      await expect(shellService.assertProvisioned([profile('mira', ['shell'])])).rejects.toThrow(
        /collegium-mira.*cannot be assumed/s
      );
    });
  });
});
