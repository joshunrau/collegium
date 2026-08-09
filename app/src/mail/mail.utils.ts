import type { MailMessage, MailParty, MailSummary } from './mail.types.ts';

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
