import { beforeEach, describe, expect, it } from 'vitest';

import { ProcessRunner } from '../process.runner.ts';

describe('ProcessRunner', () => {
  let runner: ProcessRunner;

  beforeEach(() => {
    runner = new ProcessRunner();
  });

  it('should capture stdout and a clean exit', async () => {
    const result = await runner.spawnCaptured('bash', ['-c', 'printf hello'], { captureLimitChars: 1_000, cwd: '/' });
    expect(result.success && result.value).toMatchObject({ code: 0, stderr: '', stdout: 'hello' });
  });

  it('should report a non-zero exit code with its stderr', async () => {
    const result = await runner.spawnCaptured('bash', ['-c', 'printf oops >&2; exit 3'], {
      captureLimitChars: 1_000,
      cwd: '/'
    });
    expect(result.success && result.value).toMatchObject({ code: 3, stderr: 'oops' });
  });

  it('should close stdin so a reader exits instead of hanging', async () => {
    const result = await runner.spawnCaptured('bash', ['-c', 'cat'], { captureLimitChars: 1_000, cwd: '/' });
    expect(result.success && result.value.code).toBe(0);
  });

  it('should keep a stream up to the limit and count what it printed past it', async () => {
    const result = await runner.spawnCaptured('bash', ['-c', 'head -c 5000 /dev/zero | tr "\\0" x'], {
      captureLimitChars: 1_000,
      cwd: '/'
    });
    expect(result.success && result.value.stdout).toBe('x'.repeat(1_000));
    expect(result.success && result.value.droppedChars).toStrictEqual({ stderr: 0, stdout: 4_000 });
  });

  it('should return a spawn failure when the binary does not exist', async () => {
    const result = await runner.spawnCaptured('collegium-no-such-binary', [], { captureLimitChars: 1_000, cwd: '/' });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.message).toContain('ENOENT');
  });
});
