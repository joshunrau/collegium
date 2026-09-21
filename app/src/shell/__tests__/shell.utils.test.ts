import { describe, expect, it } from 'vitest';

import { OUTPUT_CAP_CHARS, SHELL_OS_USER_ID_BASE, SHELL_OS_USER_ID_COUNT } from '../shell.constants.ts';
import {
  buildCommandProbeArgv,
  buildProbeArgv,
  buildRunArgv,
  buildWorkspaceGrantCommands,
  buildWorkspaceProbeArgv,
  deriveShellHomeDir,
  deriveShellOsIdentities,
  deriveShellOsUser,
  parsePresentCommands,
  toRunOutput
} from '../shell.utils.ts';

import type { CapturedProcess } from '../shell.types.ts';

const captured = (over: Partial<CapturedProcess>): CapturedProcess => ({
  code: 0,
  droppedChars: { stderr: 0, stdout: 0 },
  signal: null,
  stderr: '',
  stdout: '',
  ...over
});

describe('deriveShellOsUser', () => {
  it('should prefix the agent username so the OS user is one-per-agent and cannot collide', () => {
    expect(deriveShellOsUser('mira')).toBe('collegium-mira');
  });
});

describe('deriveShellHomeDir', () => {
  it('should derive the home shell::run starts in from the agent username alone', () => {
    expect(deriveShellHomeDir('mira')).toBe('/home/collegium-mira');
  });
});

describe('deriveShellOsIdentities', () => {
  it('should derive an id from the username alone, so it survives restarts and roster changes', () => {
    expect(deriveShellOsIdentities(['mira'])).toStrictEqual([
      { agentUsername: 'mira', id: 646_747, osUser: 'collegium-mira' }
    ]);
  });

  it('should place every id in the range reserved for agents', () => {
    for (const { id } of deriveShellOsIdentities(['mira', 'kevin', 'tess'])) {
      expect(id).toBeGreaterThanOrEqual(SHELL_OS_USER_ID_BASE);
      expect(id).toBeLessThan(SHELL_OS_USER_ID_BASE + SHELL_OS_USER_ID_COUNT);
    }
  });

  it('should not depend on the order the agents are listed in', () => {
    const [mira] = deriveShellOsIdentities(['mira', 'kevin']);
    const [, listedLast] = deriveShellOsIdentities(['kevin', 'mira']);
    expect(listedLast).toStrictEqual(mira);
  });

  it('should refuse two usernames deriving one id rather than confine them together', () => {
    expect(() => deriveShellOsIdentities(['aaml', 'aafn'])).toThrow('derive the same OS user id');
  });
});

describe('buildRunArgv', () => {
  it('should drop to the OS user and enforce the deadline as that user with timeout(1)', () => {
    expect(buildRunArgv('collegium-mira', 'ls -la')).toStrictEqual([
      '--non-interactive',
      '--set-home',
      '--user',
      'collegium-mira',
      '--',
      'timeout',
      '--kill-after=5',
      '60',
      'bash',
      '-lc',
      'cd -- "$HOME" || exit 1; exec bash -o pipefail -c "$1" "$0"',
      'collegium-shell',
      'ls -la'
    ]);
  });

  it('should run the command under pipefail so a pipeline reports its failing stage', () => {
    expect(buildRunArgv('collegium-mira', 'curl x | node').find((arg) => arg.includes('pipefail'))).toBe(
      'cd -- "$HOME" || exit 1; exec bash -o pipefail -c "$1" "$0"'
    );
  });

  it('should pass the command as a single argv element, never re-parsed on our side', () => {
    expect(buildRunArgv('collegium-mira', 'echo "a; b" && rm -rf x').at(-1)).toBe('echo "a; b" && rm -rf x');
  });

  // with --login sudo joins the argv into one string and escapes all but [A-Za-z0-9_-$], so the
  // target's login shell would expand a literal the approver read and fold a newline away (§6.2)
  it('should never ask sudo for a login shell, which would re-parse the command', () => {
    expect(buildRunArgv('collegium-mira', 'echo a')).not.toContain('--login');
  });
});

describe('buildCommandProbeArgv', () => {
  it('should ask the agent’s own login shell which candidates exist, under the same sudo flags (§3.8)', () => {
    expect(buildCommandProbeArgv('collegium-mira', ['node', 'curl'])).toStrictEqual([
      '--non-interactive',
      '--set-home',
      '--user',
      'collegium-mira',
      '--',
      'timeout',
      '5',
      'bash',
      '-lc',
      'command -v "$@"',
      'collegium-shell',
      'node',
      'curl'
    ]);
  });
});

describe('parsePresentCommands', () => {
  it('should name the commands from the paths command -v printed, and nothing for the ones it did not', () => {
    expect(parsePresentCommands('/usr/local/bin/node\n/usr/bin/git\n')).toStrictEqual(['node', 'git']);
    expect(parsePresentCommands('')).toStrictEqual([]);
  });
});

describe('buildWorkspaceGrantCommands', () => {
  it('should hand the workspace to the agent’s own group read-only and to nobody else (§A2)', () => {
    const identity = { agentUsername: 'mira', id: 646_747, osUser: 'collegium-mira' };
    expect(buildWorkspaceGrantCommands('/workspaces/mira', 10_001, identity)).toStrictEqual([
      { args: ['--recursive', '10001:646747', '/workspaces/mira'], command: 'chown' },
      { args: ['--recursive', 'u=rwX,g=rX,o=', '/workspaces/mira'], command: 'chmod' },
      { args: ['/workspaces/mira', '-type', 'd', '-exec', 'chmod', 'g+s', '{}', '+'], command: 'find' }
    ]);
  });
});

describe('buildWorkspaceProbeArgv', () => {
  it('should check as the OS user that the workspace reads and does not write, with both paths in argv slots (§A2)', () => {
    const argv = buildWorkspaceProbeArgv('collegium-mira', '/workspaces/mira', '/workspaces/mira/.probe');
    expect(argv.slice(0, 5)).toStrictEqual(['--non-interactive', '--set-home', '--user', 'collegium-mira', '--']);
    expect(argv.slice(-2)).toStrictEqual(['/workspaces/mira', '/workspaces/mira/.probe']);
    expect(argv).toContain('test -x "$1" && ! test -w "$1" && test -r "$2" && ! test -w "$2"');
    expect(argv.join(' ')).not.toContain('--login');
  });
});

describe('buildProbeArgv', () => {
  it('should assume the OS user with the same sudo flags the real run uses', () => {
    expect(buildProbeArgv('collegium-mira')).toStrictEqual([
      '--non-interactive',
      '--set-home',
      '--user',
      'collegium-mira',
      '--',
      'timeout',
      '1',
      'true'
    ]);
  });
});

describe('toRunOutput', () => {
  it('should report a clean exit with both streams', () => {
    expect(toRunOutput(captured({ code: 0, stderr: 'a warning', stdout: 'done' }))).toBe(
      'exit code: 0\n\nstdout:\ndone\n\nstderr:\na warning'
    );
  });

  it('should report a non-zero exit as a result the model reasons about', () => {
    expect(toRunOutput(captured({ code: 2, stderr: 'boom' }))).toBe('exit code: 2\n\nstderr:\nboom');
  });

  it('should name the deadline when timeout(1) terminated the command', () => {
    expect(toRunOutput(captured({ code: 124, stdout: 'partial' }))).toBe(
      'the command exceeded the 60s deadline and was terminated\n\nstdout:\npartial'
    );
  });

  it('should report a signal when there is no exit code', () => {
    expect(toRunOutput(captured({ code: null, signal: 'SIGKILL' }))).toBe('terminated by signal SIGKILL');
  });

  it('should fall back to an unknown signal when neither code nor signal is present', () => {
    expect(toRunOutput(captured({ code: null, signal: null }))).toBe('terminated by signal unknown');
  });

  it('should give just the header when both streams are empty', () => {
    expect(toRunOutput(captured({ code: 0 }))).toBe('exit code: 0');
  });

  it("should keep the first line's leading spaces while dropping blank leading lines", () => {
    expect(toRunOutput(captured({ code: 0, stdout: '\n\n      7 a\n      8 b\n' }))).toBe(
      'exit code: 0\n\nstdout:\n      7 a\n      8 b'
    );
  });

  it('should cap an oversized stream and mark the truncation', () => {
    const output = toRunOutput(captured({ code: 0, stdout: 'x'.repeat(OUTPUT_CAP_CHARS + 100) }));
    expect(output).toContain(`…output truncated at ${OUTPUT_CAP_CHARS} of ${OUTPUT_CAP_CHARS + 100} characters`);
    expect(output.length).toBeLessThan(OUTPUT_CAP_CHARS + 100);
  });

  it('should count what the capture dropped in the size it names', () => {
    const output = toRunOutput(
      captured({ droppedChars: { stderr: 0, stdout: 5_000 }, stdout: 'x'.repeat(OUTPUT_CAP_CHARS + 100) })
    );
    expect(output).toContain(`of ${OUTPUT_CAP_CHARS + 5_100} characters`);
  });
});
