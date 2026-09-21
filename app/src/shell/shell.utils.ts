import { createHash } from 'node:crypto';
import * as path from 'node:path';

import { isToolGranted, isToolsetGranted } from '@/tools/tools.settings.ts';

import {
  COMMAND_DEADLINE_SECONDS,
  DEADLINE_EXIT_CODE,
  DEADLINE_KILL_GRACE_SECONDS,
  OUTPUT_CAP_CHARS,
  SHELL_HOME_ROOT,
  SHELL_OS_USER_ID_BASE,
  SHELL_OS_USER_ID_COUNT,
  SHELL_OS_USER_PREFIX
} from './shell.constants.ts';
import { SHELL_TOOLSET } from './shell.toolset.ts';

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
 * pid `timeout(1)` is watching. `pipefail` makes a pipeline report its failing stage rather than
 * its last one: without it `curl … | node` exited 0 with curl missing, and the failure sat in
 * stderr alone. The trade is that a command which means to ignore an early stage (`yes | head`)
 * now reports non-zero.
 */
const RUN_FROM_HOME = 'cd -- "$HOME" || exit 1; exec bash -o pipefail -c "$1" "$0"';

function deriveShellOsUserId(agentUsername: string): number {
  const digest = createHash('sha256').update(agentUsername).digest();
  return SHELL_OS_USER_ID_BASE + (digest.readUInt32BE(0) % SHELL_OS_USER_ID_COUNT);
}

function exceedsResultCap(text: string): boolean {
  return text.trim().length > OUTPUT_CAP_CHARS;
}

function capStream(text: string, droppedChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= OUTPUT_CAP_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, OUTPUT_CAP_CHARS)}\n…output truncated at ${OUTPUT_CAP_CHARS} of ${text.length + droppedChars} characters`;
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
 * The directory `shell::run` starts in, for the one caller that must state it to the model (§3.8):
 * the agent's own OS user's home, derived by the same rule as the user itself rather than read back
 * off disk.
 */
export function deriveShellHomeDir(agentUsername: string): string {
  return path.join(SHELL_HOME_ROOT, deriveShellOsUser(agentUsername));
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
    agentUsername,
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
 * §A2 — what makes an agent's workspace visible, read-only, to its own shell user and to nobody
 * else: the app keeps ownership, the agent's private group may read and traverse, others may not,
 * and every directory is setgid so what the app writes there later carries that group as well.
 */
export function buildWorkspaceGrantCommands(
  workspaceDir: string,
  appUid: number,
  identity: ShellOsIdentity
): readonly { readonly args: readonly string[]; readonly command: string }[] {
  return [
    { args: ['--recursive', `${appUid}:${identity.id}`, workspaceDir], command: 'chown' },
    { args: ['--recursive', 'u=rwX,g=rX,o=', workspaceDir], command: 'chmod' },
    { args: [workspaceDir, '-type', 'd', '-exec', 'chmod', 'g+s', '{}', '+'], command: 'find' }
  ];
}

/**
 * The boot probe's second half (§A2): as the agent's OS user, is its workspace readable and
 * nothing more? The script is fixed and both paths ride in argv slots, so neither is parsed on the
 * way.
 */
export function buildWorkspaceProbeArgv(osUser: string, workspaceDir: string, probeFile: string): readonly string[] {
  return [
    '--non-interactive',
    '--set-home',
    '--user',
    osUser,
    '--',
    'timeout',
    '5',
    'bash',
    '-c',
    'test -x "$1" && ! test -w "$1" && test -r "$2" && ! test -w "$2"',
    SHELL_ARGV0,
    workspaceDir,
    probeFile
  ];
}

/**
 * §3.8 — which of the candidate commands the agent's own shell finds, under the same login shell
 * the real run uses, so the preamble states what is installed rather than leaving the model to
 * discover it by failing. `command -v` prints one path per name it finds and nothing for the rest.
 */
export function buildCommandProbeArgv(osUser: string, candidates: readonly string[]): readonly string[] {
  return [
    '--non-interactive',
    '--set-home',
    '--user',
    osUser,
    '--',
    'timeout',
    '5',
    'bash',
    '-lc',
    'command -v "$@"',
    SHELL_ARGV0,
    ...candidates
  ];
}

/** the names `command -v` found, from the paths it printed */
export function parsePresentCommands(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => path.basename(line));
}

/**
 * Turn a finished child into the single text block the model reads. Any exit — zero or not — is a
 * result the model reasons about; only a failure to launch is an error, handled by the caller.
 * Where the whole capture was saved to the workspace, the result names it (§3.4).
 */
export function toRunOutput(captured: CapturedProcess, savedPath?: string): string {
  const stdout = capStream(captured.stdout, captured.droppedChars.stdout);
  const stderr = capStream(captured.stderr, captured.droppedChars.stderr);
  const sections = [
    describeExit(captured),
    stdout === '' ? undefined : `stdout:\n${stdout}`,
    stderr === '' ? undefined : `stderr:\n${stderr}`,
    savedPath === undefined
      ? undefined
      : `The whole output is saved in your workspace as ${savedPath}. Read it by line range with workspace__read.`
  ];
  return sections.filter((section) => section !== undefined).join('\n\n');
}

/** whether a stream ran past what the result carries, which is when saving the whole capture is worth anything */
export function isOverResultCap(captured: CapturedProcess): boolean {
  return exceedsResultCap(captured.stdout) || exceedsResultCap(captured.stderr);
}

/** the saved capture: the command, how it ended, and each stream as captured, with what the capture itself dropped */
export function renderSavedOutput(command: string, captured: CapturedProcess): string {
  const streams = (['stdout', 'stderr'] as const)
    .filter((stream) => captured[stream] !== '')
    .map((stream) => {
      const dropped = captured.droppedChars[stream];
      const marker = dropped === 0 ? '' : `\n…${dropped} further characters were printed and not kept`;
      return `${stream}:\n${captured[stream]}${marker}`;
    });
  return [`$ ${command}`, describeExit(captured), ...streams].join('\n\n');
}

/** a name that sorts by when it was written, which is what retention keeps the newest of */
export function nameSavedOutput(now: Date, suffix: string): string {
  return `${now.toISOString().replaceAll(/[:.]/gu, '-')}-${suffix}.txt`;
}

/** whether a grant list holds shell at all — what decides an agent gets a dedicated OS user (§A2) */
export function holdsShellGrant(grants: readonly string[]): boolean {
  return isToolsetGranted(SHELL_TOOLSET, new Set(grants));
}

/** §3.4 — only an agent that can open the saved file is given one */
export function holdsWorkspaceRead(grants: readonly string[]): boolean {
  return isToolGranted(['workspace', 'read'], new Set(grants));
}
