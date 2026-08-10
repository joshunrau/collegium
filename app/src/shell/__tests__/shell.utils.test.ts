import { describe, expect, it } from 'vitest';

import { OUTPUT_CAP_CHARS } from '../shell.constants.ts';
import { buildProbeArgv, buildRunArgv, deriveShellOsUser, toRunOutput } from '../shell.utils.ts';

import type { CapturedProcess } from '../shell.types.ts';

const captured = (over: Partial<CapturedProcess>): CapturedProcess => ({
  code: 0,
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
      'cd -- "$HOME" || exit 1; exec bash -c "$1" "$0"',
      'collegium-shell',
      'ls -la'
    ]);
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

  it('should cap an oversized stream and mark the truncation', () => {
    const output = toRunOutput(captured({ code: 0, stdout: 'x'.repeat(OUTPUT_CAP_CHARS + 100) }));
    expect(output).toContain(`…output truncated at ${OUTPUT_CAP_CHARS} characters`);
    expect(output.length).toBeLessThan(OUTPUT_CAP_CHARS + 100);
  });
});
