import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import type { AgentProfile } from '@/agents/agents.types.ts';

import { ProcessRunner } from './runners/process.runner.ts';
import { SPAWN_WORKING_DIRECTORY } from './shell.constants.ts';
import { buildProbeArgv, buildRunArgv, deriveShellOsUser, holdsShellGrant, toRunOutput } from './shell.utils.ts';

import type { ShellRunFailure, ShellRunOutput } from './shell.types.ts';

/**
 * The §A2 confinement contract. It derives each agent's dedicated OS user, runs commands as that
 * user through `sudo`, and probes at boot that the user is actually assumable. All of the
 * confinement's sophistication lives here so the tool that calls it stays trivial (§6.1).
 */
@Injectable()
export class ShellService {
  constructor(private readonly processRunner: ProcessRunner) {}

  /**
   * §6.1 boot probe — fail loudly on an undeclared policy. For every shell-holding agent it checks
   * that the derived OS user can be assumed via passwordless sudo. An unprovisioned host stops boot
   * here rather than surfacing as a first-command failure much later.
   */
  async assertProvisioned(profiles: readonly AgentProfile[]): Promise<void> {
    for (const profile of profiles) {
      if (!holdsShellGrant(profile.tools)) {
        continue;
      }
      const osUser = deriveShellOsUser(profile.username);
      const probe = await this.processRunner.spawnCaptured('sudo', buildProbeArgv(osUser), {
        cwd: SPAWN_WORKING_DIRECTORY
      });
      if (!probe.success) {
        throw new Error(
          `agent "${profile.username}" holds shell but its dedicated user is unusable: ${probe.error.message}`
        );
      }
      if (probe.value.code !== 0) {
        throw new Error(
          `agent "${profile.username}" holds shell but OS user "${osUser}" cannot be assumed via sudo ` +
            `(exit ${probe.value.code}): ${probe.value.stderr.trim()}`
        );
      }
    }
  }

  /**
   * Runs one command as the agent's OS user. Any exit — zero or not — is a result the model reasons
   * about; only a failure to launch `sudo` is an error, because a command that ran and exited told
   * us something, while one that never started did not.
   */
  async run(params: { agentUsername: string; command: string }): Promise<Result<ShellRunOutput, ShellRunFailure>> {
    const osUser = deriveShellOsUser(params.agentUsername);
    const captured = await this.processRunner.spawnCaptured('sudo', buildRunArgv(osUser, params.command), {
      cwd: SPAWN_WORKING_DIRECTORY
    });
    if (!captured.success) {
      return Result.err({ message: `the shell command could not be launched: ${captured.error.message}` });
    }
    return Result.ok({ text: toRunOutput(captured.value) });
  }
}
