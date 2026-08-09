import type { Result } from '@collegium/core/utils';

import type { MailFailure, MailMessage, MailMessageRef, MailPoll, MailSummary, OutboundMail } from './mail.types.ts';

/**
 * The seam in front of a mail vendor. One instance serves exactly one mailbox — the address is
 * fixed at construction from configuration, so whose authority a call carries is never a
 * parameter. Implementations validate every vendor response at the perimeter and speak only the
 * seam types outward; nothing outside `providers/` touches a vendor API.
 */
export abstract class MailProvider {
  /** the address this provider acts as — the fixed identity on everything sent and read */
  abstract readonly address: string;

  /**
   * The conversation the referenced message belongs to, the message itself included, oldest
   * first. Summaries only; a member's body is read by `open`ing it.
   */
  abstract getConversation(ref: MailMessageRef): Promise<Result<MailSummary[], MailFailure.Read>>;

  /**
   * The cursor at the current head of the mailbox. Everything already present is old mail and is
   * never returned by a poll from this cursor — first connection announces nothing.
   */
  abstract initializeCursor(): Promise<Result<string, MailFailure.Poll>>;

  /** the most recently received messages, newest first, at most `limit` */
  abstract listRecent(limit: number): Promise<Result<MailSummary[], MailFailure.Read>>;

  /** marks the message read in the mailbox, so a human sees it as handled. Idempotent. */
  abstract markRead(ref: MailMessageRef): Promise<Result<void, MailFailure.Read>>;

  /** the one call that returns a body: complete, as readable text, with attachments described */
  abstract open(ref: MailMessageRef): Promise<Result<MailMessage, MailFailure.Read>>;

  /**
   * Arrivals after `cursor`, oldest first, at most `limit` — a longer backlog surfaces across
   * consecutive polls, each advancing the cursor it returns. No arrival is ever skipped, though
   * one may be re-observed after a later change to the same message; the caller's dedupe key
   * makes the repeat harmless. A `cursor-reset` failure means the provider invalidated the
   * cursor and the caller must re-initialize.
   */
  abstract pollNew(cursor: string, limit: number): Promise<Result<MailPoll, MailFailure.Poll>>;

  /** proves the credentials work, mutating nothing — boot refuses a mailbox this fails for */
  abstract probe(): Promise<Result<void, MailFailure.Probe>>;

  /**
   * Sends `mail` as a reply that stays in the referenced message's conversation for every
   * recipient — threading is this method's job, never the caller's. Everything else is exactly
   * `mail`: recipients, subject, and body as given, nothing derived or added. Never retried; an
   * unresolved outcome is reported as unresolved, not as a failure.
   */
  abstract reply(ref: MailMessageRef, mail: OutboundMail): Promise<Result<void, MailFailure.Send>>;

  /** messages matching `query`, at most `limit`, ranked as the provider ranks them. The query grammar is the provider's own. */
  abstract search(query: string, limit: number): Promise<Result<MailSummary[], MailFailure.Read>>;

  /**
   * Sends `mail` as a fresh message: recipients, subject, and body exactly as given. Never
   * retried; an unresolved outcome is reported as unresolved, not as a failure.
   */
  abstract send(mail: OutboundMail): Promise<Result<void, MailFailure.Send>>;
}
