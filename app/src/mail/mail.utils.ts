import { ANNOUNCEMENT_ENVELOPE, FULL_ENVELOPE, quoteMarkdown, renderMailSegments } from './thread/thread.renderer.ts';
import { splitMailThread } from './thread/thread.splitter.ts';

import type { MailArrival, MailMessage, MailParty, MailSummary, OutboundMail } from './mail.types.ts';

function renderMailSummary(summary: MailSummary): string {
  const unread = summary.isRead ? '' : ' · unread';
  const attachments = summary.hasAttachments ? ' · has attachments' : '';
  const header = `⟨${summary.ref}⟩ ${formatMailParty(summary.sender)} — ${summary.subject} — ${summary.receivedAt.toISOString()}${unread}${attachments}`;
  return summary.preview === '' ? header : `${header}\n> ${summary.preview}`;
}

/** the one rendering of a party everywhere: `Name <address>`, or the bare address without a name */
export function formatMailParty(party: MailParty): string {
  return party.name === undefined || party.name === '' ? party.address : `${party.name} <${party.address}>`;
}

export function renderMailSummaries(summaries: readonly MailSummary[]): string {
  if (summaries.length === 0) {
    return 'no messages';
  }
  return summaries.map(renderMailSummary).join('\n');
}

/** §3.13 — a conversation says how many messages it holds, so one message reads as a thread of one rather than as a listing */
export function renderMailConversation(summaries: readonly MailSummary[]): string {
  if (summaries.length === 0) {
    return 'no messages';
  }
  const count =
    summaries.length === 1
      ? '1 message in this conversation'
      : `${summaries.length} messages in this conversation, oldest first`;
  return `${count}\n${renderMailSummaries(summaries)}`;
}

/**
 * §3.13 — the announcement body: the whole thread in one blockquote, the head under its real
 * headers and every quoted message under whatever its boundary carried, a rule between them.
 */
export function renderMailAnnouncement(arrival: MailArrival, receivedAtFormatted: string): string {
  const thread = splitMailThread(arrival.body);
  const head = {
    body: thread.headBody,
    envelope: {
      date: receivedAtFormatted,
      from: formatMailParty(arrival.sender),
      ...(arrival.subject === '' ? {} : { subject: arrival.subject })
    }
  };
  return quoteMarkdown(renderMailSegments([head, ...thread.quoted], ANNOUNCEMENT_ENVELOPE));
}

/** one message in full, as readable text; attachments are described, and their absence stated, so none is never read as withheld (§3.13) */
export function renderMailMessage(message: MailMessage): string {
  const thread = splitMailThread(message.body);
  const parties = (label: string, list: readonly MailParty[]) => {
    return list.length === 0 ? [] : [`${label}: ${list.map(formatMailParty).join(', ')}`];
  };
  const attachments =
    message.attachments.length === 0
      ? ['Attachments: none']
      : [
          'Attachments (content is not retrievable):',
          ...message.attachments.map(
            (attachment) => `- ${attachment.name} (${attachment.type}, ${attachment.size} bytes)`
          )
        ];
  return [
    `⟨${message.ref}⟩${message.isRead ? '' : ' · unread'}`,
    `From: ${formatMailParty(message.sender)}`,
    ...parties('To', message.to),
    ...parties('Cc', message.cc),
    ...parties('Reply-To', message.replyTo),
    `Subject: ${message.subject}`,
    `Received: ${message.receivedAt.toISOString()}`,
    ...attachments,
    '',
    renderMailSegments([{ body: thread.headBody, envelope: {} }, ...thread.quoted], FULL_ENVELOPE)
  ].join('\n');
}

/** exactly what leaves, with any extra argument fields dropped — the provider owns threading */
export function toOutboundMail(args: OutboundMail): OutboundMail {
  return { body: args.body, cc: args.cc, subject: args.subject, to: args.to };
}

/** what leaves, in full: every recipient the approver must see, the subject, and the whole body (§6.3) */
export function renderOutboundPayload(intent: string, args: OutboundMail): string {
  const mail = toOutboundMail(args);
  return [
    `${intent}:`,
    '',
    `To: ${mail.to.join(', ')}`,
    ...(mail.cc.length === 0 ? [] : [`Cc: ${mail.cc.join(', ')}`]),
    `Subject: ${mail.subject}`,
    '',
    mail.body
  ].join('\n');
}
