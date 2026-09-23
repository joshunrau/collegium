import type { PostFile } from '@/chat/chat.types.ts';
import type { TriggerSource } from '@/prisma/prisma.types.ts';

import type { Trigger } from './triggers.types.ts';

/** what a trigger becomes on the wire: the post, and any file carrying content a post cannot hold */
type RenderedTrigger = {
  readonly files: readonly PostFile[];
  readonly message: string;
};

/**
 * How a source's trigger reads: its heading, what its item did, what the source calls its own
 * reference id, whether a body it supplies already names sender and subject, and whether its text
 * is an instruction to carry out rather than outside content to read and report on (§4.2).
 */
type SourceRendering = {
  readonly bodyDescribesItself: boolean;
  readonly instructs: boolean;
  readonly label: string;
  readonly referenceLabel: string;
  readonly verb: string;
};

const ATTACHED_BODY_FILENAME = 'message.md';

const SOURCES: { readonly [Source in TriggerSource]: SourceRendering } = {
  cron: { bodyDescribesItself: true, instructs: true, label: 'Scheduled', referenceLabel: 'schedule', verb: 'fired' },
  mail: {
    bodyDescribesItself: true,
    instructs: false,
    label: 'New Mail',
    referenceLabel: 'mail ref',
    verb: 'arrived'
  },
  webhook: {
    bodyDescribesItself: false,
    instructs: false,
    label: 'Webhook',
    referenceLabel: 'sender ref',
    verb: 'arrived'
  }
};

/** the reference in labelled fields, the sender's own id among them, so nothing in it reads as the trigger's id */
function summarize(
  reference: PrismaJson.TriggerReference,
  { referenceLabel }: SourceRendering,
  describedByBody: boolean
): string | undefined {
  const described = describedByBody
    ? []
    : [reference.subject, reference.sender === undefined ? undefined : `from ${reference.sender}`];
  const parts = [...described, reference.id === undefined ? undefined : `${referenceLabel} ${reference.id}`].filter(
    (part) => part !== undefined
  );
  return parts.length === 0 ? undefined : parts.join(' · ');
}

/**
 * §4.2 — the framework's id is the one token bracketed, so the sender's reference is never taken
 * for what triggers::resolve accepts. An instructing source's text is the operator's, to carry out;
 * any other's is outside content, so its announcement reports an arrival and asks for a reading,
 * and an action that leaves the workspace on its account is a person's call (§3.7).
 */
function renderHeader(trigger: Trigger, { instructs, label, verb }: SourceRendering): string {
  const ask = instructs ? 'Its text is the operator’s instruction: carry it out' : 'Read it and say here what it needs';
  return `🔔 ${label} → @${trigger.targetAgentUsername}\n\n⟨${trigger.id}⟩ ${verb}. ${ask}, then mark it done with \`triggers__resolve("${trigger.id}")\`.`;
}

/** §4.2 — whether a source's text is the operator's instruction, which the agent carries out, rather than outside content */
export function isOperatorInstruction(source: TriggerSource): boolean {
  return SOURCES[source].instructs;
}

/**
 * §4.2 — the announcement: a fixed template mentioning the agent, never an agent thinking (§3.2).
 * A body is disclosed in full: inline while it fits the substrate's post limit, and otherwise as an
 * attached file the post points at, since a body nobody can read is a body nobody is checking (§6.2).
 * The reference summary rides above the body, without the sender and subject when the source
 * declares its bodies self-describing.
 */
export function renderTriggerPost(trigger: Trigger, maxPostSizeChars: number): RenderedTrigger {
  const source = SOURCES[trigger.source];
  const { body } = trigger.reference;
  const hasBody = body !== undefined && body.trim() !== '';
  const summary = summarize(trigger.reference, source, hasBody && source.bodyDescribesItself);
  const preamble = [renderHeader(trigger, source), ...(summary === undefined ? [] : [summary])].join('\n\n');
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
