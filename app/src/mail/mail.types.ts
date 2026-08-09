import type { MimeType } from '@/core/core.types.ts';

/**
 * An identifier for one message, issued by the provider and meaningful only to the provider that
 * issued it. Callers hold it opaquely and hand it back; they never parse it.
 */
export type MailMessageRef = string;

/** one party on a message; display strings are derived from this, never stored beside it */
export type MailParty = {
  readonly address: string;
  readonly name?: string;
};

/** what listing, searching, and gathering a conversation return — never a body; only `open` returns a body */
export type MailSummary = {
  readonly isRead: boolean;
  /** a short plain-text excerpt, never the full body */
  readonly preview: string;
  readonly receivedAt: Date;
  readonly ref: MailMessageRef;
  readonly sender: MailParty;
  readonly subject: string;
};

/** described only — name, type, size. Content is never retrievable, which the tool layer says out loud. */
export type MailAttachment = {
  readonly name: string;
  /** in bytes */
  readonly size: number;
  /** MIME type as the sender declared it */
  readonly type: MimeType;
};

/** one message in full. The body is readable text whatever the sender's formatting, and is never bounded. */
export type MailMessage = {
  readonly attachments: readonly MailAttachment[];
  readonly body: string;
  readonly cc: readonly MailParty[];
  readonly isRead: boolean;
  readonly receivedAt: Date;
  readonly ref: MailMessageRef;
  /** where the sender asked replies to go; empty means replies go to the sender */
  readonly replyTo: readonly MailParty[];
  readonly sender: MailParty;
  readonly subject: string;
  readonly to: readonly MailParty[];
};

/**
 * What a send or reply carries. Recipients, subject, and body are exactly what leaves — the
 * provider never derives, adds, or drops any of them. There is no bcc: a recipient the approver
 * cannot see must not be possible, so the shape has nowhere to put one.
 */
export type OutboundMail = {
  readonly body: string;
  readonly cc: readonly string[];
  readonly subject: string;
  readonly to: readonly string[];
};

/** one inbound message as a poll reports it: what an announcement carries, plus the ref to work it by */
export type MailArrival = {
  readonly body: string;
  readonly receivedAt: Date;
  readonly ref: MailMessageRef;
  readonly sender: MailParty;
  readonly subject: string;
};

/** one page of new arrivals, oldest first */
export type MailPoll = {
  /**
   * The advanced cursor, to persist only after every arrival here is durably recorded. A crash
   * before persisting re-reads the same page; trigger dedupe keys absorb the repeats.
   */
  readonly cursor: string;
  readonly messages: readonly MailArrival[];
};

export declare namespace MailFailure {
  /** credentials refused — configuration rot (an expired secret), not a transient outage */
  type Auth = {
    kind: 'auth';
    message: string;
  };
  /**
   * The provider invalidated the cursor (an expired delta token, an IMAP UIDVALIDITY change).
   * The caller re-initializes and announces nothing, exactly as on first connection — loudly in
   * the log, never as a flood of announcements.
   */
  type CursorReset = {
    kind: 'cursor-reset';
    message: string;
  };
  /** the ref names no message the mailbox holds — a stale ref is a result, not an exception */
  type NotFound = {
    kind: 'not-found';
    ref: MailMessageRef;
  };
  /** the provider could not be reached or answered incoherently; safe to try again later */
  type ProviderUnavailable = {
    kind: 'provider-unavailable';
    message: string;
  };
  /** the provider refused the request as malformed — a model-supplied value it would not accept */
  type Rejected = {
    kind: 'rejected';
    message: string;
  };
  /** the send definitively did not happen — nothing left the building */
  type SendRefused = {
    kind: 'send-refused';
    message: string;
  };
  /**
   * The outcome cannot be established: the connection died after the payload was handed over.
   * Reported as unresolved, never as a failure — and never, ever retried.
   */
  type SendUnresolved = {
    kind: 'send-unresolved';
    message: string;
  };
  type Poll = Auth | CursorReset | ProviderUnavailable;
  type Probe = Auth | ProviderUnavailable;
  type Read = Auth | NotFound | ProviderUnavailable | Rejected;
  type Send = Auth | NotFound | ProviderUnavailable | Rejected | SendRefused | SendUnresolved;
  type Any = Auth | CursorReset | NotFound | ProviderUnavailable | Rejected | SendRefused | SendUnresolved;
}

export type MailFailure = MailFailure.Any;
