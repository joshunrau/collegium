import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { PROJECT_ROOT } from '../constants.ts';

const DEFAULT_TIMEOUT_MS = 60_000;

export async function exec(
  command: string,
  args: string[],
  { env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS }: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
): Promise<string> {
  const child = spawn(command, args, {
    cwd: PROJECT_ROOT,
    env,
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs
  });

  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });

  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });

  const [code, signal] = (await once(child, 'close')) as [null | number, NodeJS.Signals | null];
  const output = stderr + stdout;

  if (code === 0) {
    return output;
  }

  const cause = signal ? `killed with ${signal}` : `exited with code ${code}`;
  throw new Error(`${command} ${args.join(' ')} ${cause}\n${output}`);
}
