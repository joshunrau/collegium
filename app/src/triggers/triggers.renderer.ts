import type { PostFile } from '@/chat/chat.types.ts';
import type { TriggerSource } from '@/prisma/prisma.types.ts';

import type { Trigger } from './triggers.types.ts';

/** what a trigger becomes on the wire: the post, and any file carrying content a post cannot hold */
type RenderedTrigger = {
  readonly files: readonly PostFile[];
  readonly message: string;
};

/** how a source's trigger reads: its heading, and whether a body it supplies already names sender and subject */
type SourceRendering = {
  readonly bodyDescribesItself: boolean;
  readonly label: string;
};

const ATTACHED_BODY_FILENAME = 'message.md';

const SOURCES: { readonly [Source in TriggerSource]: SourceRendering } = {
  mail: { bodyDescribesItself: true, label: 'New Mail' },
  webhook: { bodyDescribesItself: false, label: 'Webhook' }
};

function summarize(reference: PrismaJson.TriggerReference): string | undefined {
  const parts = [reference.subject, reference.sender === undefined ? undefined : `from ${reference.sender}`].filter(
    (part) => part !== undefined
  );
  return parts.length === 0 ? undefined : parts.join(' · ');
}

function renderHeader(trigger: Trigger, label: string): string {
  const item = trigger.reference.id === undefined ? 'it' : `⟨${trigger.reference.id}⟩`;
  return `🔔 ${label} → @${trigger.targetAgentUsername}\n\nHandle ${item}, then mark it done with \`triggers__resolve("${trigger.id}")\`.`;
}

/**
 * §4.2 — the announcement: a fixed template mentioning the agent, never an agent thinking (§3.2).
 * A body is disclosed in full: inline while it fits the substrate's post limit, and otherwise as an
 * attached file the post points at, since a body nobody can read is a body nobody is checking (§6.2).
 * The reference summary rides above the body unless the source declares its bodies self-describing.
 */
export function renderTriggerPost(trigger: Trigger, maxPostSizeChars: number): RenderedTrigger {
  const { bodyDescribesItself, label } = SOURCES[trigger.source];
  const { body } = trigger.reference;
  const hasBody = body !== undefined && body.trim() !== '';
  const summary = hasBody && bodyDescribesItself ? undefined : summarize(trigger.reference);
  const preamble = [renderHeader(trigger, label), ...(summary === undefined ? [] : [summary])].join('\n\n');
  if (!hasBody) {
    return { files: [], message: preamble };
  }
  const inline = `${preamble}\n\n${body}`;
  if (inline.length <= maxPostSizeChars) {
    return { files: [], message: inline };
  }
  return {
    files: [{ content: body, filename: ATTACHED_BODY_FILENAME }],
    message: `${preamble}\n\nThe message is too large to post, so its full text is attached as ${ATTACHED_BODY_FILENAME}.`
  };
}

export type { RenderedTrigger };
