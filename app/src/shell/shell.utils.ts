import { createHash } from 'node:crypto';

import {
  COMMAND_DEADLINE_SECONDS,
  DEADLINE_EXIT_CODE,
  DEADLINE_KILL_GRACE_SECONDS,
  OUTPUT_CAP_CHARS,
  SHELL_OS_USER_ID_BASE,
  SHELL_OS_USER_ID_COUNT,
  SHELL_OS_USER_PREFIX
} from './shell.constants.ts';

import type { CapturedProcess, ShellOsIdentity } from './shell.types.ts';

/**
 * `$0` for the inner shell, so a command that reports its own name says something legible rather
 * than naming the wrapper's arguments.
 */
const SHELL_ARGV0 = 'collegium-shell';

/**
 * Establishes what `sudo --login` used to, without letting sudo near the command: `--set-home` puts
 * the agent's own home in `$HOME` from the passwd database, this cds there, and `-l` on the outer
 * shell reads the login profiles. The command rides in its own argv slot and reaches the inner shell
 * as a quoted `"$1"`, so nothing between the approver and execution re-parses it. `exec` keeps the
 * pid `timeout(1)` is watching.
 */
const RUN_FROM_HOME = 'cd -- "$HOME" || exit 1; exec bash -c "$1" "$0"';

function deriveShellOsUserId(agentUsername: string): number {
  const digest = createHash('sha256').update(agentUsername).digest();
  return SHELL_OS_USER_ID_BASE + (digest.readUInt32BE(0) % SHELL_OS_USER_ID_COUNT);
}

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
 * The OS identity of each shell-holding agent, both halves a function of the username alone. The
 * number is derived rather than allocated or read back off the agent's home directory, because
 * neither survives the ways a deployment changes: allocation depends on the order configuration
 * lists agents in, so adding one agent can hand it the id an existing agent's files already carry,
 * and a volume's ownership is not a fact everywhere — a Docker Desktop bind mount reports whatever
 * the caller happens to be. Derived, an agent's files stay its own across restarts, image rebuilds,
 * and configuration changes, and a departed agent's id is never reissued to anyone else.
 *
 * Two usernames deriving one id would put two agents in one confinement, so it is a refusal naming
 * both rather than a silent merge.
 */
export function deriveShellOsIdentities(agentUsernames: readonly string[]): readonly ShellOsIdentity[] {
  const identities = agentUsernames.map((agentUsername) => ({
    id: deriveShellOsUserId(agentUsername),
    osUser: deriveShellOsUser(agentUsername)
  }));
  const osUsersById = new Map<number, string[]>();
  for (const { id, osUser } of identities) {
    osUsersById.set(id, [...(osUsersById.get(id) ?? []), osUser]);
  }
  for (const [id, osUsers] of osUsersById) {
    if (osUsers.length > 1) {
      throw new Error(`${osUsers.join(' and ')} derive the same OS user id (${id}); rename one of these agents`);
    }
  }
  return identities;
}

/**
 * The command line that runs one shell command as the agent's OS user. `sudo` execs this argv
 * directly — deliberately *without* `--login`, because with a login shell sudo does not exec at all:
 * it joins every argument into one string, backslash-escaping all but `[A-Za-z0-9_-$]`, and hands
 * that to the target's login shell. A single-quoted `$TOKEN` the approver read as a literal would be
 * expanded, and a two-line command would fold into one — §6.2's guarantee is that the bytes approved
 * are the bytes that run, so the login shell is reached another way (see `RUN_FROM_HOME`).
 *
 * `env_reset` is a sudoers default and holds without `--login`, so the app's secrets still never
 * reach the child. The deadline is enforced by `timeout(1)` running *as the dedicated user*: the
 * service user cannot signal a process owned by another user, and the setuid `sudo` parent runs as
 * root, so a Node-side kill would silently EPERM.
 */
export function buildRunArgv(osUser: string, command: string): readonly string[] {
  return [
    '--non-interactive',
    '--set-home',
    '--user',
    osUser,
    '--',
    'timeout',
    `--kill-after=${DEADLINE_KILL_GRACE_SECONDS}`,
    String(COMMAND_DEADLINE_SECONDS),
    'bash',
    '-lc',
    RUN_FROM_HOME,
    SHELL_ARGV0,
    command
  ];
}

/**
 * The boot probe (§6.1): can the app assume this OS user via passwordless sudo at all? It mirrors
 * the run invocation's sudo flags, or a host where one succeeds and the other fails would pass boot
 * and break on the first real command.
 */
export function buildProbeArgv(osUser: string): readonly string[] {
  return ['--non-interactive', '--set-home', '--user', osUser, '--', 'timeout', '1', 'true'];
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
