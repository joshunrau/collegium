import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { writeRetainedWorkspaceFile } from '@/workspace/workspace.utils.ts';

import { ProcessRunner } from './runners/process.runner.ts';
import {
  CAPTURE_LIMIT_CHARS,
  SAVED_OUTPUT_DIRECTORY,
  SAVED_OUTPUT_RETAINED,
  SHELL_PROBED_COMMANDS,
  SPAWN_WORKING_DIRECTORY,
  WORKSPACE_PROBE_FILE
} from './shell.constants.ts';
import {
  buildCommandProbeArgv,
  buildProbeArgv,
  buildRunArgv,
  buildWorkspaceProbeArgv,
  deriveShellOsUser,
  holdsShellGrant,
  holdsWorkspaceRead,
  isOverResultCap,
  nameSavedOutput,
  parsePresentCommands,
  renderSavedOutput,
  toRunOutput
} from './shell.utils.ts';

import type { CapturedProcess, ShellRunFailure, ShellRunOutput } from './shell.types.ts';

/**
 * The §A2 confinement contract. It derives each agent's dedicated OS user, runs commands as that
 * user through `sudo`, and probes at boot that the user is actually assumable. All of the
 * confinement's sophistication lives here so the tool that calls it stays trivial (§6.1).
 */
@Injectable()
export class ShellService {
  /** §3.8 — what the boot probe found installed, fixed for the life of the process; empty until a shell-holding agent's user was probed */
  private presentCommands: readonly string[] = [];

  constructor(
    private readonly loggingService: LoggingService,
    private readonly processRunner: ProcessRunner
  ) {}

  /**
   * §6.1 boot probe — fail loudly on an undeclared policy. For every shell-holding agent it checks
   * that the derived OS user can be assumed via passwordless sudo. An unprovisioned host stops boot
   * here rather than surfacing as a first-command failure much later, and so does a workspace that
   * user cannot read or could write (§A2). Once one user is assumable, its shell is asked which of
   * the candidate commands exist, so the preamble can say so (§3.8).
   */
  async assertProvisioned(profiles: readonly AgentProfile[]): Promise<void> {
    const holders = profiles.filter((profile) => holdsShellGrant(profile.tools));
    for (const profile of holders) {
      const osUser = deriveShellOsUser(profile.username);
      await this.assertAssumable(profile.username, osUser);
      await this.assertWorkspaceReadOnly(profile, osUser);
    }
    const first = holders[0];
    if (first !== undefined) {
      this.presentCommands = await this.probeCommands(deriveShellOsUser(first.username));
    }
  }

  /** §3.8 — the commands the boot probe found, for the preamble of every shell-holding agent */
  listPresentCommands(): readonly string[] {
    return this.presentCommands;
  }

  /**
   * Runs one command as the agent's OS user. Any exit — zero or not — is a result the model reasons
   * about; only a failure to launch `sudo` is an error, because a command that ran and exited told
   * us something, while one that never started did not.
   */
  async run(params: { command: string; profile: AgentProfile }): Promise<Result<ShellRunOutput, ShellRunFailure>> {
    const osUser = deriveShellOsUser(params.profile.username);
    const captured = await this.processRunner.spawnCaptured('sudo', buildRunArgv(osUser, params.command), {
      captureLimitChars: CAPTURE_LIMIT_CHARS,
      cwd: SPAWN_WORKING_DIRECTORY
    });
    if (!captured.success) {
      return Result.err({ message: `the shell command could not be launched: ${captured.error.message}` });
    }
    const savedPath =
      isOverResultCap(captured.value) && holdsWorkspaceRead(params.profile.tools)
        ? await this.saveOutput(params.profile, params.command, captured.value)
        : undefined;
    return Result.ok({ text: toRunOutput(captured.value, savedPath) });
  }

  private async assertAssumable(agentUsername: string, osUser: string): Promise<void> {
    const probe = await this.processRunner.spawnCaptured('sudo', buildProbeArgv(osUser), {
      captureLimitChars: CAPTURE_LIMIT_CHARS,
      cwd: SPAWN_WORKING_DIRECTORY
    });
    if (!probe.success) {
      throw new Error(
        `agent "${agentUsername}" holds shell but its dedicated user is unusable: ${probe.error.message}`
      );
    }
    if (probe.value.code !== 0) {
      throw new Error(
        `agent "${agentUsername}" holds shell but OS user "${osUser}" cannot be assumed via sudo ` +
          `(exit ${probe.value.code}): ${probe.value.stderr.trim()}`
      );
    }
  }

  /** §A2 — a file the app wrote is readable, and nothing in the workspace writable, as the agent's own OS user */
  private async assertWorkspaceReadOnly(profile: AgentProfile, osUser: string): Promise<void> {
    const probeFile = path.join(profile.workspaceDir, WORKSPACE_PROBE_FILE);
    await fs.promises.writeFile(probeFile, '');
    try {
      const probe = await this.processRunner.spawnCaptured(
        'sudo',
        buildWorkspaceProbeArgv(osUser, profile.workspaceDir, probeFile),
        { captureLimitChars: CAPTURE_LIMIT_CHARS, cwd: SPAWN_WORKING_DIRECTORY }
      );
      if (!probe.success) {
        throw new Error(
          `agent "${profile.username}" holds shell but its workspace could not be probed: ${probe.error.message}`
        );
      }
      if (probe.value.code !== 0) {
        throw new Error(
          `agent "${profile.username}" holds shell but OS user "${osUser}" cannot read ${profile.workspaceDir}, ` +
            `or can write it (exit ${probe.value.code}): ${probe.value.stderr.trim()}`
        );
      }
    } finally {
      await fs.promises.rm(probeFile, { force: true });
    }
  }

  /** a probe that cannot run leaves the list empty and the preamble silent; the image is the source of truth, not this */
  private async probeCommands(osUser: string): Promise<readonly string[]> {
    const probe = await this.processRunner.spawnCaptured('sudo', buildCommandProbeArgv(osUser, SHELL_PROBED_COMMANDS), {
      captureLimitChars: CAPTURE_LIMIT_CHARS,
      cwd: SPAWN_WORKING_DIRECTORY
    });
    if (!probe.success) {
      this.loggingService.warn(`could not probe which commands the shell offers: ${probe.error.message}`);
      return [];
    }
    return parsePresentCommands(probe.value.stdout);
  }

  /**
   * §3.4 — the app writing its own directory with what the approved command already printed. The
   * command has run either way, so a capture that cannot be saved costs the model the rest of its
   * output, not the result it is owed.
   */
  private async saveOutput(
    profile: AgentProfile,
    command: string,
    captured: CapturedProcess
  ): Promise<string | undefined> {
    try {
      return await writeRetainedWorkspaceFile(profile.workspaceDir, {
        content: renderSavedOutput(command, captured),
        directory: SAVED_OUTPUT_DIRECTORY,
        name: nameSavedOutput(new Date(), randomUUID().slice(0, 8)),
        retain: SAVED_OUTPUT_RETAINED
      });
    } catch (error) {
      this.loggingService.error(new Error(`failed to save shell output for "${profile.username}"`, { cause: error }));
      return undefined;
    }
  }
}
