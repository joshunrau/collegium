import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ProcessRunner } from '../runners/process.runner.ts';
import { OUTPUT_CAP_CHARS } from '../shell.constants.ts';
import { ShellService } from '../shell.service.ts';

import type { CapturedProcess } from '../shell.types.ts';

const profile = (username: string, tools: readonly string[], workspaceDir = '/nowhere'): AgentProfile => {
  return { tools, username, workspaceDir } as AgentProfile;
};

const exited = (stdout: string): Result<CapturedProcess, never> => {
  return Result.ok({ code: 0, droppedChars: { stderr: 0, stdout: 0 }, signal: null, stderr: '', stdout });
};

describe('ShellService', () => {
  let processRunner: MockedInstance<ProcessRunner>;
  let shellService: ShellService;

  beforeEach(async () => {
    processRunner = MockFactory.createMock(ProcessRunner);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ShellService,
        { provide: LoggingService, useValue: MockFactory.createMock(LoggingService) },
        { provide: ProcessRunner, useValue: processRunner }
      ]
    }).compile();
    shellService = moduleRef.get(ShellService);
  });

  describe('run', () => {
    it('should run the command as the agent’s derived OS user and return the formatted output', async () => {
      processRunner.spawnCaptured.mockResolvedValue(exited('mira'));
      const result = await shellService.run({ command: 'id -un', profile: profile('mira', ['shell']) });
      const [file, args] = processRunner.spawnCaptured.mock.calls[0]!;
      expect(file).toBe('sudo');
      expect(args).toContain('collegium-mira');
      expect(args.at(-1)).toBe('id -un');
      expect(result.success && result.value.text).toBe('exit code: 0\n\nstdout:\nmira');
    });

    it('should surface a launch failure as an error, since a command that never started told us nothing', async () => {
      processRunner.spawnCaptured.mockResolvedValue(Result.err({ message: 'spawn sudo ENOENT' }));
      const result = await shellService.run({ command: 'id -un', profile: profile('mira', ['shell']) });
      expect(!result.success && result.error.message).toContain('could not be launched');
    });

    describe('with output past what a result carries (§3.4)', () => {
      let workspaceDir: string;

      beforeEach(() => {
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-shell-'));
        processRunner.spawnCaptured.mockResolvedValue(exited('x'.repeat(OUTPUT_CAP_CHARS + 1)));
      });

      afterEach(() => {
        fs.rmSync(workspaceDir, { force: true, recursive: true });
      });

      it('should save the whole capture to the workspace of an agent that can read it, and name the file', async () => {
        const result = await shellService.run({
          command: 'yes',
          profile: profile('mira', ['shell', 'workspace'], workspaceDir)
        });
        const savedPath = /saved in your workspace as (\S+)\./u.exec(result.unwrap().text)?.[1];
        expect(savedPath).toMatch(/^shell-output\/.+\.txt$/u);
        const saved = fs.readFileSync(path.join(workspaceDir, savedPath!), 'utf8');
        expect(saved).toContain(`$ yes\n\nexit code: 0\n\nstdout:\n${'x'.repeat(OUTPUT_CAP_CHARS + 1)}`);
      });

      it('should save nothing for an agent that could not open the file', async () => {
        const result = await shellService.run({ command: 'yes', profile: profile('mira', ['shell'], workspaceDir) });
        expect(result.unwrap().text).not.toContain('saved in your workspace');
        expect(fs.readdirSync(workspaceDir)).toStrictEqual([]);
      });
    });
  });

  describe('assertProvisioned', () => {
    it('should never probe when no agent holds the shell tool (dev and e2e stay untouched)', async () => {
      await shellService.assertProvisioned([profile('mira', []), profile('tess', ['write_file'])]);
      expect(processRunner.spawnCaptured).not.toHaveBeenCalled();
    });

    it('should pass when a shell-holding agent’s OS user is assumable', async () => {
      processRunner.spawnCaptured.mockResolvedValue(exited(''));
      await expect(shellService.assertProvisioned([profile('mira', ['shell'])])).resolves.toBeUndefined();
    });

    it('should keep the commands the probe found, asked of the first shell-holding agent’s own shell (§3.8)', async () => {
      processRunner.spawnCaptured.mockResolvedValueOnce(exited(''));
      processRunner.spawnCaptured.mockResolvedValueOnce(exited('/usr/local/bin/node\n/usr/bin/git\n'));
      await shellService.assertProvisioned([profile('mira', ['shell'])]);
      expect(processRunner.spawnCaptured.mock.calls[1]![1]).toContain('command -v "$@"');
      expect(shellService.listPresentCommands()).toStrictEqual(['node', 'git']);
    });

    it('should leave the commands unknown when no agent holds the shell tool', async () => {
      await shellService.assertProvisioned([profile('mira', [])]);
      expect(shellService.listPresentCommands()).toStrictEqual([]);
    });

    it('should stop boot loudly when sudo cannot be launched at all', async () => {
      processRunner.spawnCaptured.mockResolvedValue(Result.err({ message: 'spawn sudo ENOENT' }));
      await expect(shellService.assertProvisioned([profile('mira', ['shell'])])).rejects.toThrow(/mira.*unusable/s);
    });

    it('should stop boot loudly when the OS user cannot be assumed', async () => {
      processRunner.spawnCaptured.mockResolvedValue(
        Result.ok({
          code: 1,
          droppedChars: { stderr: 0, stdout: 0 },
          signal: null,
          stderr: 'sudo: a password is required',
          stdout: ''
        })
      );
      await expect(shellService.assertProvisioned([profile('mira', ['shell'])])).rejects.toThrow(
        /collegium-mira.*cannot be assumed/s
      );
    });
  });
});
