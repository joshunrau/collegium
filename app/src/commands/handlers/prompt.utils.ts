/** Mattermost rejects a post over 16383 characters; the fence and the notice ride inside this */
const MAX_RESPONSE_CHARS = 16_000;

/** held back so the truncation notice can never itself push the response over the cap */
const TRUNCATION_NOTICE_RESERVE = 64;

export function renderPromptResponse(agentUsername: string, prompt: string): string {
  const fence = (body: string) => `System prompt for @${agentUsername} in this channel:\n\`\`\`text\n${body}\n\`\`\``;
  const budget = MAX_RESPONSE_CHARS - fence('').length - TRUNCATION_NOTICE_RESERVE;
  if (prompt.length <= budget) {
    return fence(prompt);
  }
  return `${fence(prompt.slice(0, budget))}\n… [truncated, ${prompt.length - budget} characters omitted]`;
}
