import { beforeEach, describe, expect, it } from 'vitest';

import { ProcessRunner } from '../process.runner.ts';

describe('ProcessRunner', () => {
  let runner: ProcessRunner;

  beforeEach(() => {
    runner = new ProcessRunner();
  });

  it('should capture stdout and a clean exit', async () => {
    const result = await runner.spawnCaptured('bash', ['-c', 'printf hello']);
    expect(result.success && result.value).toMatchObject({ code: 0, stderr: '', stdout: 'hello' });
  });

  it('should report a non-zero exit code with its stderr', async () => {
    const result = await runner.spawnCaptured('bash', ['-c', 'printf oops >&2; exit 3']);
    expect(result.success && result.value).toMatchObject({ code: 3, stderr: 'oops' });
  });

  it('should close stdin so a reader exits instead of hanging', async () => {
    const result = await runner.spawnCaptured('bash', ['-c', 'cat']);
    expect(result.success && result.value.code).toBe(0);
  });

  it('should return a spawn failure when the binary does not exist', async () => {
    const result = await runner.spawnCaptured('collegium-no-such-binary', []);
    expect(result.success).toBe(false);
    expect(!result.success && result.error.message).toContain('ENOENT');
  });
});
