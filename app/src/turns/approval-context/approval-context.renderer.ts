import { match } from 'ts-pattern';

import type { TurnRequest } from '@/conversations/conversations.types.ts';

/** enough of a request for a sentence of it, never enough for a pasted document */
const REQUEST_EXCERPT_CHARS = 140;

function renderExcerpt(message: string): string {
  const collapsed = message.replaceAll(/\s+/gu, ' ').trim();
  if (collapsed.length <= REQUEST_EXCERPT_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, REQUEST_EXCERPT_CHARS)}…`;
}

export type ApprovalContext = {
  readonly actionBudget: number;
  readonly actionNumber: number;
  /** §3.7 — the reasoned denial of this tool earlier in the turn, so the payload reads as the amendment it is */
  readonly follows?: { readonly byUsername: string; readonly reason: string; readonly toolName: string };
  /** a human's message already stripped of peer mentions (§4.5), because quoting one back would address it */
  readonly requestedBy: TurnRequest | undefined;
};

/**
 * §3.7 — the line above an approval payload: where in the turn's budget this action falls, who
 * asked for the work, and the denial this call answers. Every word is the framework's or a
 * person's, read from the turn record; nothing a tool
 * returned reaches it. A colleague is named without its @, since the prompt posts under the agent's
 * account and a mention there would start the colleague's turn (§4.5).
 */
export function renderApprovalContext(context: ApprovalContext): string {
  const asked = match(context.requestedBy)
    .with(undefined, { kind: 'system' }, () => 'raised by a trigger')
    .with({ kind: 'agent' }, ({ username }) => `asked by colleague ${username}`)
    .with({ kind: 'human' }, ({ message, username }) => `requested by @${username}: "${renderExcerpt(message)}"`)
    .exhaustive();
  const follows =
    context.follows === undefined
      ? []
      : [
          `after @${context.follows.byUsername} denied ${context.follows.toolName}: "${renderExcerpt(context.follows.reason)}"`
        ];
  return [`Action ${context.actionNumber} of ${context.actionBudget}`, asked, ...follows].join(' · ');
}
