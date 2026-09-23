import type { StablePromptInput } from '../prompt.types.ts';

export function renderRepliesPreamble({ granted }: StablePromptInput): string {
  const reports = granted.some(({ id: [namespace, tool] }) => namespace === 'tasks' && tool === 'report');
  const unreported = reports
    ? " Once in a turn, a reply that mentions no colleague here and no person is also refused while a unit assigned to you here is not reported, since nothing then starts its creator's turn; the same reply sent again is posted."
    : '';
  return `The framework posts your reply. Text with no tool call is your final message: it goes to the channel and the turn stops. If the framework cannot post it, because it mentions (@handle) a second colleague, carries a tool call written as text, holds no prose, was cut off at your output limit, or is longer than one post holds, you are told why and may answer again, and two refusals in a row end the turn.${unreported} Text you write beside a tool call is shown in your status post while the turn runs, and is dropped from that post when the turn ends. It stays in your context for the rest of the turn, and in your record of this channel afterwards. The people here read your status post; they do not read your tool results or your reasoning.`;
}
