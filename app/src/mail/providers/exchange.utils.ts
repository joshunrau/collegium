import { Result } from '@collegium/core/utils';

import { toMarkdown } from '@/web/web.utils.ts';

import { $ExchangeCursor } from './exchange.schemas.ts';

import type { MailFailure, MailParty, MailSummary, OutboundMail } from '../mail.types.ts';
import type { $GraphMessage, $GraphMessageSummary, $GraphRecipient } from './exchange.schemas.ts';

export function toMailParty(recipient: $GraphRecipient): MailParty {
  const { address, name } = recipient.emailAddress;
  return name === undefined ? { address } : { address, name };
}

/** a message with no `from` (a rare system artifact) still summarizes, with an empty sender */
export function toSenderParty(summary: $GraphMessageSummary): MailParty {
  return summary.from === undefined ? { address: '' } : toMailParty(summary.from);
}

export function toMailSummary(summary: $GraphMessageSummary): MailSummary {
  return {
    isRead: summary.isRead,
    preview: summary.bodyPreview,
    receivedAt: summary.receivedDateTime,
    ref: summary.id,
    sender: toSenderParty(summary),
    subject: summary.subject
  };
}

/** readable text whatever the sender's formatting: HTML is rendered to markdown, text passes through */
export function renderGraphBody(body: $GraphMessage['body']): string {
  if (body === undefined) {
    return '';
  }
  return body.contentType === 'html' ? toMarkdown(body.content) : body.content;
}

export function parseExchangeCursor(cursor: string): Result<$ExchangeCursor, MailFailure.CursorReset> {
  let raw: unknown;
  try {
    raw = JSON.parse(cursor);
  } catch {
    return Result.err({ kind: 'cursor-reset', message: 'the stored cursor could not be read' });
  }
  const parsed = $ExchangeCursor.safeParse(raw);
  if (!parsed.success) {
    return Result.err({ kind: 'cursor-reset', message: 'the stored cursor could not be read' });
  }
  return Result.ok(parsed.data);
}

export function serializeExchangeCursor(cursor: $ExchangeCursor): string {
  return JSON.stringify(cursor);
}

/** exactly the approved content in Graph's shape — recipients, subject, and body as given, nothing added */
export function toGraphOutbound(mail: OutboundMail): {
  body: { content: string; contentType: 'text' };
  ccRecipients: { emailAddress: { address: string } }[];
  subject: string;
  toRecipients: { emailAddress: { address: string } }[];
} {
  return {
    body: { content: mail.body, contentType: 'text' },
    ccRecipients: mail.cc.map((address) => ({ emailAddress: { address } })),
    subject: mail.subject,
    toRecipients: mail.to.map((address) => ({ emailAddress: { address } }))
  };
}

/** past the fixed watermark, or beside it without being one of the messages already there */
export function isNewArrival(cursor: $ExchangeCursor, item: { id: string; receivedDateTime: Date }): boolean {
  const watermarkMs = new Date(cursor.watermark).getTime();
  const receivedMs = item.receivedDateTime.getTime();
  if (receivedMs !== watermarkMs) {
    return receivedMs > watermarkMs;
  }
  return !cursor.boundaryIds.includes(item.id);
}
