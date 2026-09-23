import { readFile } from 'node:fs/promises';

/** the errors a process's status gives once the process has gone: its directory is removed, or it vanishes mid-read */
const GONE_CODES: ReadonlySet<unknown> = new Set(['ENOENT', 'ESRCH']);

/**
 * A process's resident memory as Linux reports it to any process of the same user, in bytes;
 * undefined once the process has gone, or is a zombie, whose status carries no memory at all.
 */
export async function readResidentMemoryBytes(pid: number): Promise<number | undefined> {
  let status: string;
  try {
    status = await readFile(`/proc/${pid}/status`, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && GONE_CODES.has(error.code)) {
      return undefined;
    }
    throw error;
  }
  const kibibytes = /^VmRSS:\s+(\d+) kB$/mu.exec(status)?.[1];
  return kibibytes === undefined ? undefined : Number(kibibytes) * 1024;
}
