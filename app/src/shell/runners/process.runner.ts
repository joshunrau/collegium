import { spawn } from 'node:child_process';

import { Result, toErrorMessage } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import type { CapturedProcess, ShellSpawnFailure } from '../shell.types.ts';

/**
 * The seam over `child_process` — the OS is the vendor. It launches a process, captures both
 * streams, and resolves on close. It imposes no deadline of its own: `timeout(1)` owns the deadline
 * as the dedicated user, because a Node-side kill of a process running as another user would EPERM.
 */
@Injectable()
export class ProcessRunner {
  spawnCaptured(
    file: string,
    args: readonly string[],
    options: { cwd: string }
  ): Promise<Result<CapturedProcess, ShellSpawnFailure>> {
    return new Promise((resolve) => {
      const child = spawn(file, [...args], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk;
      });
      // a spawn failure (e.g. `sudo` missing) emits 'error' before 'close'; resolving once lets it win
      child.on('error', (error) => resolve(Result.err({ message: toErrorMessage(error) })));
      child.on('close', (code, signal) => resolve(Result.ok({ code, signal, stderr, stdout })));
    });
  }
}
