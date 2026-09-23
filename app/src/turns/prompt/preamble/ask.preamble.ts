import type { StablePromptInput } from '../prompt.types.ts';

export function renderAskPreamble({ granted }: StablePromptInput): string | undefined {
  if (!granted.some(({ id: [namespace, tool] }) => namespace === 'ask' && tool === 'human')) {
    return undefined;
  }
  return "ask__human waits with no timeout for one person in this channel to answer; nobody outside it can. Text you write beside the call is shown to them above the question, and the answer comes back as that call's result with the person's name.";
}
