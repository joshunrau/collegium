import type { StablePromptInput } from '../prompt.types.ts';

export function renderRepliesPreamble({ granted }: StablePromptInput): string {
  const holds = (tool: string) => granted.some(({ id: [namespace, name] }) => namespace === 'tasks' && name === tool);
  const unreported = holds('report')
    ? " Once in a turn, a reply that mentions no colleague here and no person is also refused while a unit assigned to you here is not reported, since nothing then starts its creator's turn; the same reply sent again is posted."
    : '';
  const unjudged = holds('close')
    ? ' Once in a turn, such a reply is also refused while a report among the posts this turn answers awaits your verdict; the same reply sent again is posted.'
    : '';
  // §3.15 — the exception is conditional here; the result of the unit post says when it holds
  const quietly =
    holds('assign') || holds('report')
      ? ", except an empty ending after a unit post of yours has handed work to a colleague and the turn owes no one else a reply; that post's result says when this holds"
      : '';
  return `The framework posts your reply. Text with no tool call is your final message: it goes to the channel and the turn stops. If the framework cannot post it, because it mentions (@handle) a second colleague, carries a tool call written as text, holds no prose${quietly}, was cut off at your output limit or ran past your time limit, or is longer than one post holds, you are told why and may answer again, and two refusals in a row end the turn.${unreported}${unjudged} Text you write beside a tool call is shown in your status post while the turn runs, and is dropped from that post when the turn ends. It stays in your context for the rest of the turn, and in your record of this channel afterwards. The people here read your status post; they do not read your tool results or your reasoning.`;
}
