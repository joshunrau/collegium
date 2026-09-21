import { match } from 'ts-pattern';

import type { TriggerOrigin, TurnRequest, TurnRequestOrigin } from '@/conversations/conversations.types.ts';
import type { TriggerSource } from '@/prisma/prisma.types.ts';

/** enough of a request for a sentence of it, never enough for a pasted document */
const REQUEST_EXCERPT_CHARS = 140;

/** §3.2 — a trigger's source in the approver's words */
const SOURCE_WORDS: { readonly [Source in TriggerSource]: string } = {
  cron: 'scheduled',
  mail: 'mail',
  webhook: 'webhook'
};

function renderExcerpt(message: string): string {
  const collapsed = message.replaceAll(/\s+/gu, ' ').trim();
  if (collapsed.length <= REQUEST_EXCERPT_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, REQUEST_EXCERPT_CHARS)}…`;
}

/** §3.7 — a trigger-started turn says which trigger, and that no person asked: the item's own text is never an instruction */
function renderTriggerOrigin(trigger: TriggerOrigin | undefined): string {
  if (trigger === undefined) {
    return 'raised by a trigger, not by a person';
  }
  const item = trigger.reference === undefined ? '' : ` (⟨${trigger.reference}⟩)`;
  return `raised by a ${SOURCE_WORDS[trigger.source]} trigger${item}, not by a person`;
}

/** §3.7 — the person whose request a colleague's relay serves, so the approver is not deciding on a colleague's word alone */
function renderRelayOrigin(origin: TurnRequestOrigin | undefined): string {
  return match(origin)
    .with(undefined, () => '')
    .with({ kind: 'human' }, ({ message, username }) => `, for @${username}: "${renderExcerpt(message)}"`)
    .with({ kind: 'system' }, () => ', on an item a trigger raised')
    .exhaustive();
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
    .with(undefined, () => renderTriggerOrigin(undefined))
    .with({ kind: 'system' }, ({ trigger }) => renderTriggerOrigin(trigger))
    .with(
      { kind: 'agent' },
      ({ onBehalfOf, username }) => `asked by colleague ${username}${renderRelayOrigin(onBehalfOf)}`
    )
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
