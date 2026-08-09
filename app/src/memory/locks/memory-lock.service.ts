import { Injectable } from '@nestjs/common';

/**
 * Serialises work per agent. Turns are per-channel (§5.1), so one agent can have two of them writing
 * memory at once, and the entry cap is a read-modify-write (§3.6).
 */
@Injectable()
export class MemoryLockService {
  private readonly chains = new Map<string, Promise<unknown>>();

  run<TResult>(agentUsername: string, task: () => Promise<TResult>): Promise<TResult> {
    const previous = this.chains.get(agentUsername) ?? Promise.resolve();
    const result = previous.then(task);
    this.chains.set(
      agentUsername,
      result.catch(() => undefined)
    );
    return result;
  }
}
