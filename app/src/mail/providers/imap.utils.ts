import { Result, toErrorMessage } from '@collegium/core/utils';
import type { AddressObject, ParsedMail } from 'mailparser';

import { toMarkdown } from '@/web/web.utils.ts';

import { $ImapCursor } from './imap.schemas.ts';

import type { MailArrival, MailFailure, MailMessage, MailMessageRef, MailParty } from '../mail.types.ts';

const PREVIEW_CHARS = 140;

const REF_SHAPE = /^(\d+):(\d+)$/;

/** `uidValidity:uid` — meaningful only within the mailbox generation that issued it */
export function serializeImapRef(uidValidity: bigint, uid: number): MailMessageRef {
  return `${uidValidity}:${uid}`;
}

export function parseImapRef(ref: MailMessageRef): Result<{ uid: number; uidValidity: string }, MailFailure.NotFound> {
  const matched = REF_SHAPE.exec(ref);
  if (!matched) {
    return Result.err({ kind: 'not-found', ref });
  }
  return Result.ok({ uid: Number(matched[2]), uidValidity: matched[1]! });
}

export function parseImapCursor(cursor: string): Result<$ImapCursor, MailFailure.CursorReset> {
  let raw: unknown;
  try {
    raw = JSON.parse(cursor);
  } catch {
    return Result.err({ kind: 'cursor-reset', message: 'the stored cursor could not be read' });
  }
  const parsed = $ImapCursor.safeParse(raw);
  if (!parsed.success) {
    return Result.err({ kind: 'cursor-reset', message: 'the stored cursor could not be read' });
  }
  return Result.ok(parsed.data);
}

export function serializeImapCursor(cursor: $ImapCursor): string {
  return JSON.stringify(cursor);
}

export function toParties(input: AddressObject | AddressObject[] | undefined): MailParty[] {
  const objects = input === undefined ? [] : [input].flat();
  return objects.flatMap((entry) =>
    entry.value.map(({ address, name }) =>
      name === '' ? { address: address ?? '' } : { address: address ?? '', name }
    )
  );
}

export function toSenderPartyFromParsed(parsed: ParsedMail): MailParty {
  return toParties(parsed.from)[0] ?? { address: '' };
}

/** readable text whatever the sender's formatting: HTML is rendered to markdown, text passes through */
export function renderParsedBody(parsed: ParsedMail): string {
  if (typeof parsed.html === 'string') {
    return toMarkdown(parsed.html);
  }
  return parsed.text ?? '';
}

/** a short single-line excerpt, never the full body */
export function toPreview(text: string | undefined): string {
  return (text ?? '').replaceAll(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);
}

/** the server's receipt time (INTERNALDATE), or the read itself when the server gave none it could parse */
export function toObservedAt(internalDate: Date | string | undefined): Date {
  const date = internalDate === undefined ? new Date() : new Date(internalDate);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** `observedAt` stands in for a missing Date header */
export function toMailArrival(parsed: ParsedMail, ref: MailMessageRef, observedAt: Date): MailArrival {
  return {
    body: renderParsedBody(parsed),
    receivedAt: parsed.date ?? observedAt,
    ref,
    sender: toSenderPartyFromParsed(parsed),
    subject: parsed.subject ?? ''
  };
}

/**
 * §6.7 through nodemailer's error surface: a server response code means the server answered and
 * did not accept, so nothing left — refused. A connection that never established is equally
 * definitive. Anything else — a timeout or a socket dying after the payload was handed over —
 * cannot be established either way and is unresolved, never retried.
 */
export function classifySmtpFailure(error: unknown): MailFailure.Send {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    const responseCode =
      'responseCode' in error && typeof error.responseCode === 'number' ? error.responseCode : undefined;
    if (code === 'EAUTH') {
      return { kind: 'auth', message: `the SMTP server refused the credentials: ${error.message}` };
    }
    if (responseCode !== undefined) {
      return { kind: 'send-refused', message: `the SMTP server refused the send: ${error.message}` };
    }
    if (code === 'ECONNECTION' || code === 'EDNS') {
      return { kind: 'send-refused', message: `the SMTP server could not be reached: ${error.message}` };
    }
    return { kind: 'send-unresolved', message: `the connection failed mid-send: ${error.message}` };
  }
  return { kind: 'send-unresolved', message: toErrorMessage(error) };
}

export function toMailMessage(parsed: ParsedMail, ref: MailMessageRef, isRead: boolean, observedAt: Date): MailMessage {
  return {
    attachments: parsed.attachments.map((attachment) => ({
      name: attachment.filename ?? '',
      size: attachment.size,
      type: attachment.contentType
    })),
    body: renderParsedBody(parsed),
    cc: toParties(parsed.cc),
    isRead,
    receivedAt: parsed.date ?? observedAt,
    ref,
    replyTo: toParties(parsed.replyTo),
    sender: toSenderPartyFromParsed(parsed),
    subject: parsed.subject ?? '',
    to: toParties(parsed.to)
  };
}
