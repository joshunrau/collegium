import {
  COMMAND_DEADLINE_SECONDS,
  DEADLINE_EXIT_CODE,
  DEADLINE_KILL_GRACE_SECONDS,
  OUTPUT_CAP_CHARS,
  SHELL_OS_USER_PREFIX
} from './shell.constants.ts';

import type { CapturedProcess } from './shell.types.ts';

function capStream(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= OUTPUT_CAP_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, OUTPUT_CAP_CHARS)}\n…output truncated at ${OUTPUT_CAP_CHARS} characters`;
}

function describeExit(captured: CapturedProcess): string {
  if (captured.code === DEADLINE_EXIT_CODE) {
    return `the command exceeded the ${COMMAND_DEADLINE_SECONDS}s deadline and was terminated`;
  }
  if (captured.code === null) {
    return `terminated by signal ${captured.signal ?? 'unknown'}`;
  }
  return `exit code: ${captured.code}`;
}

/**
 * The dedicated OS user a shell-holding agent runs as — derived, never configured, so §A2's "one
 * per shell-holding agent" is structural and two agents can never be pointed at the same user.
 */
export function deriveShellOsUser(agentUsername: string): string {
  return `${SHELL_OS_USER_PREFIX}${agentUsername}`;
}

/**
 * The command line that runs one shell command as the agent's OS user. `sudo --login` drops to that
 * user with a clean login environment (env_reset), so the app's secrets never reach the child, and
 * the deadline is enforced by `timeout(1)` running *as the dedicated user*: the service user cannot
 * signal a process owned by another user, and the setuid `sudo` parent runs as root, so a Node-side
 * kill would silently EPERM. Every element is a distinct argv entry — the command is never re-parsed
 * by an intermediate shell on our side.
 */
export function buildRunArgv(osUser: string, command: string): readonly string[] {
  return [
    '--non-interactive',
    '--login',
    '--user',
    osUser,
    '--',
    'timeout',
    `--kill-after=${DEADLINE_KILL_GRACE_SECONDS}`,
    String(COMMAND_DEADLINE_SECONDS),
    'bash',
    '-c',
    command
  ];
}

/** the boot probe (§6.1): can the app assume this OS user via passwordless sudo at all? */
export function buildProbeArgv(osUser: string): readonly string[] {
  return ['--non-interactive', '--user', osUser, '--', 'timeout', '1', 'true'];
}

/**
 * Turn a finished child into the single text block the model reads. Any exit — zero or not — is a
 * result the model reasons about; only a failure to launch is an error, handled by the caller.
 */
export function toRunOutput(captured: CapturedProcess): string {
  const stdout = capStream(captured.stdout);
  const stderr = capStream(captured.stderr);
  const body = [stdout === '' ? undefined : `stdout:\n${stdout}`, stderr === '' ? undefined : `stderr:\n${stderr}`]
    .filter((section) => section !== undefined)
    .join('\n\n');
  const header = describeExit(captured);
  return body === '' ? header : `${header}\n\n${body}`;
}
