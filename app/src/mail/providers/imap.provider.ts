import type { $ImapMailProvider } from '@collegium/core/toolsets';
import { Result, toErrorMessage } from '@collegium/core/utils';
import { ImapFlow } from 'imapflow';
import type { FetchMessageObject, MailboxObject, SearchObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

import { MailProvider } from '../mail.provider.ts';
import {
  classifySmtpFailure,
  parseImapCursor,
  parseImapRef,
  serializeImapCursor,
  serializeImapRef,
  toMailArrival,
  toMailMessage,
  toObservedAt,
  toPreview,
  toSenderPartyFromParsed
} from './imap.utils.ts';

import type {
  MailArrival,
  MailFailure,
  MailMessage,
  MailMessageRef,
  MailParty,
  MailPoll,
  MailSummary,
  OutboundMail
} from '../mail.types.ts';

/** enough of the source for a preview without downloading whole attachments */
const PREVIEW_SOURCE_BYTES = 32_768;

/** one page is enough for a working thread; a longer conversation is history, not context */
const CONVERSATION_PAGE_SIZE = 50;

/** where a reply should thread: the original's message id joins the tail of its own references chain */
type ReplyThreading = {
  inReplyTo: string | undefined;
  references: string[];
};

export class ImapMailProvider extends MailProvider {
  readonly address: string;
  private readonly config: $ImapMailProvider;
  private transporter: Transporter | undefined;

  constructor(config: $ImapMailProvider) {
    super();
    this.address = config.address;
    this.config = config;
  }

  async getConversation(ref: MailMessageRef): Promise<Result<MailSummary[], MailFailure.Read>> {
    const parsedRef = parseImapRef(ref);
    if (!parsedRef.success) {
      return parsedRef;
    }
    return this.withInbox<MailSummary[], MailFailure.Read>(async (client, mailbox) => {
      if (String(mailbox.uidValidity) !== parsedRef.value.uidValidity) {
        return Result.err({ kind: 'not-found', ref });
      }
      const target = await client.fetchOne(String(parsedRef.value.uid), { source: true }, { uid: true });
      if (!target || target.source === undefined) {
        return Result.err({ kind: 'not-found', ref });
      }
      const parsed = await simpleParser(target.source);
      const chain = parsed.references === undefined ? [] : [parsed.references].flat();
      const ids = [...new Set([parsed.messageId, ...chain])].filter((id) => id !== undefined);
      if (ids.length === 0) {
        return Result.ok([await this.toSummary(target, mailbox)]);
      }
      const terms = ids.flatMap((id): SearchObject[] => [
        { header: { 'in-reply-to': id } },
        { header: { 'message-id': id } },
        { header: { references: id } }
      ]);
      const found = await client.search(terms.length === 1 ? terms[0]! : { or: terms }, { uid: true });
      const uids = [...new Set([...(found === false ? [] : found), parsedRef.value.uid])]
        .toSorted((a, b) => a - b)
        .slice(0, CONVERSATION_PAGE_SIZE);
      const summaries = await this.fetchSummaries(client, mailbox, uids);
      return Result.ok(summaries.toSorted((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()));
    });
  }

  initializeCursor(): Promise<Result<string, MailFailure.Poll>> {
    return this.withInbox((_client, mailbox) => {
      return Promise.resolve(
        Result.ok(serializeImapCursor({ uidNext: mailbox.uidNext, uidValidity: String(mailbox.uidValidity) }))
      );
    });
  }

  listRecent(limit: number): Promise<Result<MailSummary[], MailFailure.Read>> {
    return this.withInbox<MailSummary[], MailFailure.Read>(async (client, mailbox) => {
      if (mailbox.exists === 0) {
        return Result.ok([]);
      }
      const start = Math.max(1, mailbox.exists - limit + 1);
      const summaries: MailSummary[] = [];
      for await (const message of client.fetch(`${start}:*`, {
        envelope: true,
        flags: true,
        source: { maxLength: PREVIEW_SOURCE_BYTES },
        uid: true
      })) {
        summaries.push(await this.toSummary(message, mailbox));
      }
      return Result.ok(summaries.toSorted((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()));
    });
  }

  markRead(ref: MailMessageRef): Promise<Result<void, MailFailure.Read>> {
    const parsedRef = parseImapRef(ref);
    if (!parsedRef.success) {
      return Promise.resolve(parsedRef);
    }
    return this.withInbox<void, MailFailure.Read>(async (client, mailbox) => {
      if (String(mailbox.uidValidity) !== parsedRef.value.uidValidity) {
        return Result.err({ kind: 'not-found', ref });
      }
      const flagged = await client.messageFlagsAdd(String(parsedRef.value.uid), ['\\Seen'], { uid: true });
      if (!flagged) {
        return Result.err({ kind: 'provider-unavailable', message: 'the seen flag could not be set' });
      }
      return Result.ok();
    });
  }

  open(ref: MailMessageRef): Promise<Result<MailMessage, MailFailure.Read>> {
    const parsedRef = parseImapRef(ref);
    if (!parsedRef.success) {
      return Promise.resolve(parsedRef);
    }
    return this.withInbox<MailMessage, MailFailure.Read>(async (client, mailbox) => {
      if (String(mailbox.uidValidity) !== parsedRef.value.uidValidity) {
        return Result.err({ kind: 'not-found', ref });
      }
      const fetched = await client.fetchOne(
        String(parsedRef.value.uid),
        { flags: true, internalDate: true, source: true },
        { uid: true }
      );
      if (!fetched || fetched.source === undefined) {
        return Result.err({ kind: 'not-found', ref });
      }
      const parsed = await simpleParser(fetched.source);
      return Result.ok(
        toMailMessage(parsed, ref, fetched.flags?.has('\\Seen') ?? false, toObservedAt(fetched.internalDate))
      );
    });
  }

  pollNew(cursor: string, limit: number): Promise<Result<MailPoll, MailFailure.Poll>> {
    const parsedCursor = parseImapCursor(cursor);
    if (!parsedCursor.success) {
      return Promise.resolve(parsedCursor);
    }
    return this.withInbox<MailPoll, MailFailure.Poll>(async (client, mailbox) => {
      if (String(mailbox.uidValidity) !== parsedCursor.value.uidValidity) {
        return Result.err({ kind: 'cursor-reset', message: 'the mailbox generation (UIDVALIDITY) changed' });
      }
      const found = await client.search({ uid: `${parsedCursor.value.uidNext}:*` }, { uid: true });
      // `N:*` answers the newest message even when nothing is ≥ N, so the floor is re-checked here
      const fresh = (found === false ? [] : found)
        .filter((uid) => uid >= parsedCursor.value.uidNext)
        .toSorted((a, b) => a - b)
        .slice(0, limit);
      const last = fresh.at(-1);
      if (last === undefined) {
        return Result.ok({ cursor, messages: [] });
      }
      const arrivals: MailArrival[] = [];
      for (const uid of fresh) {
        const fetched = await client.fetchOne(String(uid), { internalDate: true, source: true }, { uid: true });
        if (!fetched || fetched.source === undefined) {
          // deleted between the search and this read: nothing is left to announce
          continue;
        }
        const parsed = await simpleParser(fetched.source);
        arrivals.push(
          toMailArrival(parsed, serializeImapRef(mailbox.uidValidity, uid), toObservedAt(fetched.internalDate))
        );
      }
      return Result.ok({
        cursor: serializeImapCursor({ uidNext: last + 1, uidValidity: parsedCursor.value.uidValidity }),
        messages: arrivals
      });
    });
  }

  probe(): Promise<Result<void, MailFailure.Probe>> {
    return this.withInbox(() => Promise.resolve(Result.ok()));
  }

  async reply(ref: MailMessageRef, mail: OutboundMail): Promise<Result<void, MailFailure.Send>> {
    const parsedRef = parseImapRef(ref);
    if (!parsedRef.success) {
      return parsedRef;
    }
    const threading = await this.withInbox<ReplyThreading, MailFailure.Read>(async (client, mailbox) => {
      if (String(mailbox.uidValidity) !== parsedRef.value.uidValidity) {
        return Result.err({ kind: 'not-found', ref });
      }
      const fetched = await client.fetchOne(
        String(parsedRef.value.uid),
        { source: { maxLength: PREVIEW_SOURCE_BYTES } },
        { uid: true }
      );
      if (!fetched || fetched.source === undefined) {
        return Result.err({ kind: 'not-found', ref });
      }
      const parsed = await simpleParser(fetched.source);
      const chain = parsed.references === undefined ? [] : [parsed.references].flat();
      return Result.ok({
        inReplyTo: parsed.messageId,
        references: [...chain, parsed.messageId].filter((id) => id !== undefined)
      });
    });
    if (!threading.success) {
      return threading;
    }
    return this.transmit(mail, threading.value);
  }

  search(query: string, limit: number): Promise<Result<MailSummary[], MailFailure.Read>> {
    return this.withInbox<MailSummary[], MailFailure.Read>(async (client, mailbox) => {
      const found = await client.search({ or: [{ body: query }, { from: query }, { subject: query }] }, { uid: true });
      const uids = (found === false ? [] : found).toSorted((a, b) => a - b).slice(-limit);
      const summaries = await this.fetchSummaries(client, mailbox, uids);
      return Result.ok(summaries.toSorted((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()));
    });
  }

  send(mail: OutboundMail): Promise<Result<void, MailFailure.Send>> {
    return this.transmit(mail, undefined);
  }

  /** best effort only: the send has already happened, and a missing Sent copy never reclassifies it */
  private async appendToSent(raw: Buffer): Promise<void> {
    try {
      const connected = await this.connect();
      if (!connected.success) {
        return;
      }
      const client = connected.value;
      try {
        const folders = await client.list();
        const sent = folders.find((folder) => folder.specialUse === '\\Sent');
        await client.append(sent?.path ?? 'Sent', raw, ['\\Seen']);
      } finally {
        await client.logout().catch(() => undefined);
      }
    } catch {
      // the copy is a nicety; failing loudly here would misreport a completed send
    }
  }

  private async connect(): Promise<Result<ImapFlow, MailFailure.Auth | MailFailure.ProviderUnavailable>> {
    const client = new ImapFlow({
      auth: { pass: this.config.password, user: this.config.username },
      host: this.config.imap.host,
      logger: false,
      port: this.config.imap.port,
      secure: this.config.imap.secure
    });
    try {
      await client.connect();
      return Result.ok(client);
    } catch (error) {
      if (error instanceof Error && 'authenticationFailed' in error && error.authenticationFailed === true) {
        return Result.err({ kind: 'auth', message: `the IMAP server refused the credentials: ${error.message}` });
      }
      return Result.err({ kind: 'provider-unavailable', message: toErrorMessage(error) });
    }
  }

  private async fetchSummaries(client: ImapFlow, mailbox: MailboxObject, uids: number[]): Promise<MailSummary[]> {
    if (uids.length === 0) {
      return [];
    }
    const summaries: MailSummary[] = [];
    for await (const message of client.fetch(
      uids.join(','),
      { envelope: true, flags: true, source: { maxLength: PREVIEW_SOURCE_BYTES }, uid: true },
      { uid: true }
    )) {
      summaries.push(await this.toSummary(message, mailbox));
    }
    return summaries;
  }

  private getTransporter(): Transporter {
    this.transporter ??= nodemailer.createTransport({
      auth: { pass: this.config.password, user: this.config.username },
      host: this.config.smtp.host,
      port: this.config.smtp.port,
      secure: this.config.smtp.secure
    });
    return this.transporter;
  }

  private async toSummary(message: FetchMessageObject, mailbox: MailboxObject): Promise<MailSummary> {
    const parsed = message.source === undefined ? undefined : await simpleParser(message.source);
    const from = message.envelope?.from?.[0];
    const sender: MailParty =
      from === undefined
        ? parsed === undefined
          ? { address: '' }
          : toSenderPartyFromParsed(parsed)
        : from.name
          ? { address: from.address ?? '', name: from.name }
          : { address: from.address ?? '' };
    return {
      isRead: message.flags?.has('\\Seen') ?? false,
      preview: toPreview(parsed?.text ?? undefined),
      receivedAt: message.envelope?.date ?? parsed?.date ?? new Date(0),
      ref: serializeImapRef(mailbox.uidValidity, message.uid),
      sender,
      subject: message.envelope?.subject ?? parsed?.subject ?? ''
    };
  }

  /**
   * One composition serves both the wire and the Sent copy, so what was approved is byte-for-byte
   * what leaves and what the thread later shows. The envelope is stated explicitly: exactly the
   * disclosed recipients, nothing derived.
   */
  private async transmit(
    mail: OutboundMail,
    threading: ReplyThreading | undefined
  ): Promise<Result<void, MailFailure.Send>> {
    const raw = await new MailComposer({
      cc: [...mail.cc],
      from: this.address,
      ...(threading?.inReplyTo === undefined ? {} : { inReplyTo: threading.inReplyTo }),
      ...(threading !== undefined && threading.references.length > 0 ? { references: threading.references } : {}),
      subject: mail.subject,
      text: mail.body,
      to: [...mail.to]
    })
      .compile()
      .build();
    try {
      await this.getTransporter().sendMail({
        envelope: { from: this.address, to: [...mail.to, ...mail.cc] },
        raw
      });
    } catch (error) {
      return Result.err(classifySmtpFailure(error));
    }
    await this.appendToSent(raw);
    return Result.ok();
  }

  private async withInbox<TValue, TFailure>(
    fn: (client: ImapFlow, mailbox: MailboxObject) => Promise<Result<TValue, TFailure>>
  ): Promise<Result<TValue, MailFailure.Auth | MailFailure.ProviderUnavailable | TFailure>> {
    const connected = await this.connect();
    if (!connected.success) {
      return connected;
    }
    const client = connected.value;
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        if (typeof client.mailbox === 'boolean') {
          return Result.err({ kind: 'provider-unavailable', message: 'INBOX could not be opened' });
        }
        return await fn(client, client.mailbox);
      } finally {
        lock.release();
      }
    } catch (error) {
      return Result.err({ kind: 'provider-unavailable', message: toErrorMessage(error) });
    } finally {
      await client.logout().catch(() => undefined);
    }
  }
}
