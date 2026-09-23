import { match } from 'ts-pattern';

import type { TriggerOrigin, TurnRequest, TurnRequestOrigin } from '@/conversations/conversations.types.ts';
import type { TriggerSource } from '@/prisma/prisma.types.ts';
import { isOperatorInstruction } from '@/triggers/triggers.renderer.ts';

/** enough of a request for a sentence of it, never enough for a pasted document */
const REQUEST_EXCERPT_CHARS = 140;

/** §3.2 — how a trigger's source raised the turn, in the approver's words */
const TRIGGER_ORIGINS: { readonly [Source in TriggerSource]: string } = {
  cron: 'on the operator’s schedule',
  mail: 'raised by a mail trigger',
  webhook: 'raised by a webhook trigger'
};

function renderExcerpt(message: string): string {
  const collapsed = message.replaceAll(/\s+/gu, ' ').trim();
  if (collapsed.length <= REQUEST_EXCERPT_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, REQUEST_EXCERPT_CHARS)}…`;
}

/**
 * §3.7 — a trigger-started turn says which trigger. Where the item's text is outside content it
 * also says no person asked; a schedule's text is the operator's own instruction (§4.2).
 */
function renderTriggerOrigin(trigger: TriggerOrigin | undefined): string {
  if (trigger === undefined) {
    return 'raised by a trigger, not by a person';
  }
  const item = trigger.reference === undefined ? '' : ` (⟨${trigger.reference}⟩)`;
  const origin = `${TRIGGER_ORIGINS[trigger.source]}${item}`;
  return isOperatorInstruction(trigger.source) ? origin : `${origin}, not by a person`;
}

/** §3.7 — a colleague by display name (§3.1), and the unit whose assignment post started the turn (§3.15) */
type ColleagueRequest = Omit<Extract<TurnRequest, { kind: 'agent' }>, 'username'> & {
  readonly displayName: string;
  readonly unitReference: string | undefined;
};

/** §3.7 — a colleague that asked, beside the person or trigger its chain descends from (§7.4) */
function renderColleagueRequest({ displayName, onBehalfOf, unitReference }: ColleagueRequest): string {
  const asked =
    unitReference === undefined
      ? `asked by colleague ${displayName}`
      : `asked by colleague ${displayName} on work unit \`${unitReference}\``;
  return match(onBehalfOf)
    .with(undefined, () => asked)
    .with({ kind: 'human' }, ({ message, username }) => {
      return unitReference === undefined
        ? `${asked}, for @${username}: "${renderExcerpt(message)}"`
        : `${asked}, for @${username}`;
    })
    .with({ kind: 'system' }, () => `${asked}, on an item a trigger raised`)
    .exhaustive();
}

/** who asked, as the line names them: a person or trigger as the triggering post says, a colleague as §3.7 names it */
export type ApprovalRequester = ColleagueRequest | TurnRequestOrigin;

export type ApprovalContext = {
  readonly actionBudget: number;
  readonly actionNumber: number;
  /** §3.7 — the reasoned denial of this tool earlier in the turn, so the payload reads as the amendment it is */
  readonly follows?: { readonly byUsername: string; readonly reason: string; readonly toolName: string };
  /** a human's message already stripped of peer mentions (§4.5), because quoting one back would address it */
  readonly requestedBy: ApprovalRequester | undefined;
};

/**
 * §3.7 — the line above an approval payload: where in the turn's budget this action falls, who
 * asked for the work, and the denial this call answers. Every word is the framework's or a
 * person's, read from the turn record; nothing a tool
 * returned reaches it. A colleague is named by its display name, never its @, since the prompt posts
 * under the agent's account and a mention there would start the colleague's turn (§4.5).
 */
export function renderApprovalContext(context: ApprovalContext): string {
  const asked = match(context.requestedBy)
    .with(undefined, () => renderTriggerOrigin(undefined))
    .with({ kind: 'system' }, ({ trigger }) => renderTriggerOrigin(trigger))
    .with({ kind: 'agent' }, (colleague) => renderColleagueRequest(colleague))
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
