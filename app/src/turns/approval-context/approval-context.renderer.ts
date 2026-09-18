/** enough of a request for a sentence of it, never enough for a pasted document */
const REQUEST_EXCERPT_CHARS = 140;

function renderExcerpt(message: string): string {
  const collapsed = message.replaceAll(/\s+/gu, ' ').trim();
  if (collapsed.length <= REQUEST_EXCERPT_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, REQUEST_EXCERPT_CHARS)}…`;
}

/** the human whose post started the turn, quoted by the framework and by nothing else (§3.7) */
export type TurnRequester = {
  /** already stripped of peer mentions (§4.5), because quoting one back would address it */
  readonly message: string;
  readonly username: string;
};

export type ApprovalContext = {
  readonly actionBudget: number;
  readonly actionNumber: number;
  readonly requestedBy: TurnRequester | undefined;
};

/**
 * §3.7 — the line above an approval payload: where in the turn's budget this action falls, and who
 * asked for the work. Every word is the framework's, read from the turn record; nothing a tool
 * returned reaches it, and a trigger-initiated turn says so rather than repeating text written
 * elsewhere.
 */
export function renderApprovalContext(context: ApprovalContext): string {
  const asked =
    context.requestedBy === undefined
      ? 'raised by a trigger'
      : `requested by @${context.requestedBy.username}: "${renderExcerpt(context.requestedBy.message)}"`;
  return `Action ${context.actionNumber} of ${context.actionBudget} · ${asked}`;
}
