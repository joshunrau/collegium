import type { MailMessage, MailParty, MailSummary, OutboundMail } from './mail.types.ts';

function renderMailSummary(summary: MailSummary): string {
  const marker = summary.isRead ? '' : ' · unread';
  const header = `⟨${summary.ref}⟩ ${formatMailParty(summary.sender)} — ${summary.subject} — ${summary.receivedAt.toISOString()}${marker}`;
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

/** one message in full, as readable text; attachments are described and say so */
export function renderMailMessage(message: MailMessage): string {
  const parties = (label: string, list: readonly MailParty[]) =>
    list.length === 0 ? [] : [`${label}: ${list.map(formatMailParty).join(', ')}`];
  const attachments =
    message.attachments.length === 0
      ? []
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
    message.body
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
