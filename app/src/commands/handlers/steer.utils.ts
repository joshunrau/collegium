import type { Result } from '@collegium/core/utils';
import { match } from 'ts-pattern';

import type { SteerRefusal } from '@/turns/control/turn-control.registry.ts';

import { renderCommandName } from '../commands.definitions.ts';

const FIRST_WORD = /^(\S*)\s*([\s\S]*)$/u;

/** §7.5 — the answer is the invoker's alone, and names each agent by the handle the command takes back */
function renderAgentHandles(agentUsernames: readonly string[]): string {
  return agentUsernames.map((username) => `\`${username}\``).join(', ');
}

export type AddressedSteer = {
  readonly agentUsername: string | undefined;
  readonly text: string;
};

/** §7.5 — the first word names the agent only where it is one in the channel, so a steer may open with any other word */
export function readAddressedSteer(text: string, agentUsernamesHere: readonly string[]): AddressedSteer {
  const trimmed = text.trim();
  const [, firstWord = '', rest = ''] = FIRST_WORD.exec(trimmed) ?? [];
  const candidate = firstWord.replace(/^@/u, '').toLowerCase();
  if (!agentUsernamesHere.includes(candidate)) {
    return { agentUsername: undefined, text: trimmed };
  }
  return { agentUsername: candidate, text: rest };
}

/** §7.5 — the ephemeral answer says what a steer can and cannot reach, or it will be read as immediate */
export function renderSteerResponse(steered: Result<string, SteerRefusal>): string {
  if (steered.success) {
    return `Handed to ${renderAgentHandles([steered.value])}: its running turn reads it before the next model call, and a call already in flight is made again. A tool already running is not interrupted, and a turn waiting on an approval reads it only if it continues after the answer.`;
  }
  return match(steered.error)
    .with({ kind: 'nothing-running' }, () => 'Nothing is running in this channel, so there was nothing to steer.')
    .with({ kind: 'not-running' }, ({ agentUsername }) => {
      return `${renderAgentHandles([agentUsername])} has no turn running in this channel, so there was nothing to steer. Mention ${agentUsername} in a post to queue it for the next turn.`;
    })
    .with({ kind: 'ambiguous' }, ({ runningAgentUsernames }) => {
      return `More than one agent is running in this channel (${renderAgentHandles(runningAgentUsernames)}), so the steer reached none of them. Name the one it is for: ${renderCommandName('steer')} {agent} {text}`;
    })
    .exhaustive();
}
