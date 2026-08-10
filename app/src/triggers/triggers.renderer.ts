import type { PostFile } from '@/chat/chat.types.ts';

import type { Trigger } from './triggers.types.ts';

/** what a trigger becomes on the wire: the post, and any file carrying content a post cannot hold */
type RenderedTrigger = {
  readonly files: readonly PostFile[];
  readonly message: string;
};

const ATTACHED_BODY_FILENAME = 'message.md';

function summarize(reference: PrismaJson.TriggerReference): string {
  const parts = [
    reference.subject,
    reference.sender === undefined ? undefined : `from ${reference.sender}`,
    reference.id === undefined ? undefined : `ref ${reference.id}`
  ].filter((part) => part !== undefined);
  return parts.length > 0 ? parts.join(' · ') : 'a new event';
}

function renderHeader(trigger: Trigger): string {
  return `🔔 @${trigger.targetAgentUsername} — ${trigger.source}: ${summarize(trigger.reference)}. Handle it, then mark it done with resolve_trigger("${trigger.id}").`;
}

/**
 * §4.2 — the announcement: a fixed template mentioning the agent, never an agent thinking (§3.2).
 * A body is disclosed in full: inline while it fits the substrate's post limit, and otherwise as an
 * attached file the post points at, since a body nobody can read is a body nobody is checking (§6.2).
 */
export function renderTriggerPost(trigger: Trigger, maxPostSizeChars: number): RenderedTrigger {
  const header = renderHeader(trigger);
  const { body } = trigger.reference;
  if (body === undefined || body.trim() === '') {
    return { files: [], message: header };
  }
  const inline = `${header}\n\n${body}`;
  if (inline.length <= maxPostSizeChars) {
    return { files: [], message: inline };
  }
  return {
    files: [{ content: body, filename: ATTACHED_BODY_FILENAME }],
    message: `${header}\n\nThe message is too large to post, so its full text is attached as ${ATTACHED_BODY_FILENAME}.`
  };
}

export type { RenderedTrigger };
