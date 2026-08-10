import { Result } from '@collegium/core/utils';
import { match } from 'ts-pattern';
import { z } from 'zod';

import { MailProvider } from '../mail.provider.ts';
import {
  $GraphAttachmentList,
  $GraphDeltaPage,
  $GraphMessage,
  $GraphMessageSummary,
  $GraphMessageSummaryList
} from './exchange.schemas.ts';
import {
  isNewArrival,
  parseExchangeCursor,
  renderGraphBody,
  serializeExchangeCursor,
  toGraphOutbound,
  toMailParty,
  toMailSummary,
  toSenderParty
} from './exchange.utils.ts';

import type {
  MailArrival,
  MailFailure,
  MailMessage,
  MailMessageRef,
  MailPoll,
  MailSummary,
  OutboundMail
} from '../mail.types.ts';
import type { ExchangeAuth } from './exchange.auth.ts';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

const REQUEST_TIMEOUT_MS = 30_000;

/** one page is enough for a working thread; a longer conversation is history, not context */
const CONVERSATION_PAGE_SIZE = 50;

const SUMMARY_SELECT = 'id,subject,from,receivedDateTime,isRead,bodyPreview';

const MESSAGE_SELECT = `${SUMMARY_SELECT},conversationId,body,toRecipients,ccRecipients,replyTo,hasAttachments`;

/** without this, Graph message ids change when a message moves folders, and held refs die */
const PREFER_IMMUTABLE_IDS = 'IdType="ImmutableId"';

/** change detection only — an arrival's content comes from a follow-up read of the message itself */
const DELTA_SELECT = 'id,receivedDateTime';

/** what an announcement carries: sender, subject, body — no attachment listing */
const ARRIVAL_SELECT = 'id,subject,from,receivedDateTime,body';

const INITIALIZATION_PAGE_SIZE = 100;

/** a loud bound on the first-connection walk, so a misbehaving vendor cannot hold boot in a loop */
const MAX_INITIALIZATION_PAGES = 500;

type TokenSource = Pick<ExchangeAuth, 'getAccessToken'>;

export class ExchangeMailProvider extends MailProvider {
  readonly address: string;
  private readonly tokens: TokenSource;

  constructor(address: string, tokens: TokenSource) {
    super();
    this.address = address;
    this.tokens = tokens;
  }

  async getConversation(ref: MailMessageRef): Promise<Result<MailSummary[], MailFailure.Read>> {
    const opened = await this.getJson(
      { query: { $select: `${SUMMARY_SELECT},conversationId` }, ref, segments: ['messages', ref] },
      $GraphMessageSummary
    );
    if (!opened.success) {
      return opened;
    }
    const { conversationId } = opened.value;
    if (conversationId === undefined) {
      return Result.ok([toMailSummary(opened.value)]);
    }
    const thread = await this.getJson(
      {
        query: {
          $filter: `conversationId eq '${conversationId.replaceAll("'", "''")}'`,
          $select: SUMMARY_SELECT,
          $top: String(CONVERSATION_PAGE_SIZE)
        },
        segments: ['messages']
      },
      $GraphMessageSummaryList
    );
    if (!thread.success) {
      return thread;
    }
    // Graph refuses $orderby combined with this $filter, so the page is ordered here instead
    return Result.ok(
      thread.value.value.map(toMailSummary).toSorted((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
    );
  }

  /** walks the whole delta once, keeping only the high-water mark — existing mail is old and stays silent */
  async initializeCursor(): Promise<Result<string, MailFailure.Poll>> {
    let link = this.graphUrl(['mailFolders', 'inbox', 'messages', 'delta'], { $select: DELTA_SELECT }).toString();
    let watermarkMs = 0;
    let boundaryIds: string[] = [];
    for (let page = 0; page < MAX_INITIALIZATION_PAGES; page++) {
      const fetched = await this.getDeltaPage(link, INITIALIZATION_PAGE_SIZE);
      if (!fetched.success) {
        return fetched;
      }
      for (const item of fetched.value.value) {
        if ('@removed' in item) {
          continue;
        }
        const receivedMs = item.receivedDateTime.getTime();
        if (receivedMs > watermarkMs) {
          watermarkMs = receivedMs;
          boundaryIds = [item.id];
        } else if (receivedMs === watermarkMs) {
          boundaryIds.push(item.id);
        }
      }
      const { '@odata.deltaLink': deltaLink, '@odata.nextLink': nextLink } = fetched.value;
      if (deltaLink !== undefined) {
        return Result.ok(
          serializeExchangeCursor({ boundaryIds, link: deltaLink, watermark: new Date(watermarkMs).toISOString() })
        );
      }
      if (nextLink === undefined) {
        return Result.err({
          kind: 'provider-unavailable',
          message: 'a delta page carried neither a next nor a delta link'
        });
      }
      link = nextLink;
    }
    return Result.err({
      kind: 'provider-unavailable',
      message: 'the mailbox produced too many delta pages to initialize'
    });
  }

  async listRecent(limit: number): Promise<Result<MailSummary[], MailFailure.Read>> {
    const fetched = await this.getJson(
      {
        query: { $orderby: 'receivedDateTime desc', $select: SUMMARY_SELECT, $top: String(limit) },
        segments: ['mailFolders', 'inbox', 'messages']
      },
      $GraphMessageSummaryList
    );
    if (!fetched.success) {
      return fetched;
    }
    return Result.ok(fetched.value.value.map(toMailSummary));
  }

  async markRead(ref: MailMessageRef): Promise<Result<void, MailFailure.Read>> {
    const dispatched = await this.dispatch({
      body: { isRead: true },
      method: 'PATCH',
      url: this.graphUrl(['messages', ref], {})
    });
    if (!dispatched.success) {
      return dispatched;
    }
    if (!dispatched.value.ok) {
      return this.classifyFailure(dispatched.value, ref);
    }
    return Result.ok();
  }

  async open(ref: MailMessageRef): Promise<Result<MailMessage, MailFailure.Read>> {
    const fetched = await this.getJson(
      { query: { $select: MESSAGE_SELECT }, ref, segments: ['messages', ref] },
      $GraphMessage
    );
    if (!fetched.success) {
      return fetched;
    }
    const message = fetched.value;
    const attachments = message.hasAttachments
      ? await this.getJson(
          { query: { $select: 'name,contentType,size' }, ref, segments: ['messages', ref, 'attachments'] },
          $GraphAttachmentList
        )
      : Result.ok({ value: [] });
    if (!attachments.success) {
      return attachments;
    }
    return Result.ok({
      attachments: attachments.value.value.map((attachment) => ({
        name: attachment.name,
        size: attachment.size,
        type: attachment.contentType
      })),
      body: renderGraphBody(message.body),
      cc: message.ccRecipients.map(toMailParty),
      isRead: message.isRead,
      receivedAt: message.receivedDateTime,
      ref: message.id,
      replyTo: message.replyTo.map(toMailParty),
      sender: toSenderParty(message),
      subject: message.subject,
      to: message.toRecipients.map(toMailParty)
    });
  }

  async pollNew(cursor: string, limit: number): Promise<Result<MailPoll, MailFailure.Poll>> {
    const parsed = parseExchangeCursor(cursor);
    if (!parsed.success) {
      return parsed;
    }
    const fetched = await this.getDeltaPage(parsed.value.link, limit);
    if (!fetched.success) {
      return fetched;
    }
    const arrivals: MailArrival[] = [];
    for (const item of fetched.value.value) {
      if ('@removed' in item || !isNewArrival(parsed.value, item)) {
        continue;
      }
      const arrival = await this.fetchArrival(item.id);
      if (!arrival.success) {
        return arrival;
      }
      if (arrival.value !== undefined) {
        arrivals.push(arrival.value);
      }
    }
    const link = fetched.value['@odata.deltaLink'] ?? fetched.value['@odata.nextLink'];
    if (link === undefined) {
      return Result.err({
        kind: 'provider-unavailable',
        message: 'a delta page carried neither a next nor a delta link'
      });
    }
    return Result.ok({
      cursor: serializeExchangeCursor({ ...parsed.value, link }),
      messages: arrivals.toSorted((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
    });
  }

  /** GET on the inbox itself: proves the token is honoured and the RBAC scope reaches this mailbox */
  async probe(): Promise<Result<void, MailFailure.Probe>> {
    const fetched = await this.getJson(
      { query: { $select: 'id' }, segments: ['mailFolders', 'inbox'] },
      z.object({ id: z.string() })
    );
    if (fetched.success) {
      return Result.ok();
    }
    const failure = match(fetched.error)
      .with({ kind: 'auth' }, (refused): MailFailure.Probe => refused)
      .with({ kind: 'provider-unavailable' }, (unavailable): MailFailure.Probe => unavailable)
      .with({ kind: 'not-found' }, ({ ref }): MailFailure.Probe => ({
        kind: 'provider-unavailable',
        message: `"${ref}" was not found`
      }))
      .with({ kind: 'rejected' }, ({ message }): MailFailure.Probe => ({ kind: 'provider-unavailable', message }))
      .exhaustive();
    return Result.err(failure);
  }

  /**
   * createReply → overwrite → send: Exchange builds the draft so threading is its own, then the
   * draft is overwritten with exactly the approved recipients, subject, and body before sending.
   * A failure before the send step definitively sent nothing, and the stray draft is removed.
   */
  async reply(ref: MailMessageRef, mail: OutboundMail): Promise<Result<void, MailFailure.Send>> {
    const created = await this.readJson(
      this.graphUrl(['messages', ref, 'createReply'], {}),
      z.object({ id: z.string().min(1) }),
      ref,
      'POST'
    );
    if (!created.success) {
      return created;
    }
    const draftId = created.value.id;
    const overwritten = await this.dispatch({
      body: toGraphOutbound(mail),
      method: 'PATCH',
      url: this.graphUrl(['messages', draftId], {})
    });
    if (!overwritten.success || !overwritten.value.ok) {
      await this.dispatch({ method: 'DELETE', url: this.graphUrl(['messages', draftId], {}) });
      if (!overwritten.success) {
        return overwritten;
      }
      return this.classifyFailure(overwritten.value, ref);
    }
    return this.finishSend(
      await this.dispatch({ method: 'POST', url: this.graphUrl(['messages', draftId, 'send'], {}) })
    );
  }

  async search(query: string, limit: number): Promise<Result<MailSummary[], MailFailure.Read>> {
    const escaped = query.replaceAll('"', String.raw`\"`);
    const fetched = await this.getJson(
      { query: { $search: `"${escaped}"`, $select: SUMMARY_SELECT, $top: String(limit) }, segments: ['messages'] },
      $GraphMessageSummaryList
    );
    if (!fetched.success) {
      return fetched;
    }
    return Result.ok(fetched.value.value.map(toMailSummary));
  }

  async send(mail: OutboundMail): Promise<Result<void, MailFailure.Send>> {
    return this.finishSend(
      await this.dispatch({
        body: { message: toGraphOutbound(mail), saveToSentItems: true },
        method: 'POST',
        url: this.graphUrl(['sendMail'], {})
      })
    );
  }

  private async classifyFailure(response: Response, ref?: MailMessageRef): Promise<Result<never, MailFailure.Read>> {
    const body = await response.text().catch(() => undefined);
    const detail = body === undefined ? `status ${response.status}` : `status ${response.status}: ${body}`;
    if (response.status === 401 || response.status === 403) {
      return Result.err({ kind: 'auth', message: `Exchange refused the request (${detail})` });
    }
    if (response.status === 404) {
      if (ref !== undefined) {
        return Result.err({ kind: 'not-found', ref });
      }
      return Result.err({ kind: 'auth', message: `the mailbox ${this.address} was not found (${detail})` });
    }
    if (response.status === 400) {
      return Result.err({ kind: 'rejected', message: `Exchange rejected the request (${detail})` });
    }
    return Result.err({ kind: 'provider-unavailable', message: `Exchange answered ${detail}` });
  }

  private async dispatch(input: {
    body?: unknown;
    method: 'DELETE' | 'GET' | 'PATCH' | 'POST';
    prefer?: string;
    url: URL;
  }): Promise<Result<Response, MailFailure.Auth | MailFailure.ProviderUnavailable>> {
    const token = await this.tokens.getAccessToken();
    if (!token.success) {
      return token;
    }
    try {
      const response = await fetch(input.url, {
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        headers: {
          authorization: `Bearer ${token.value}`,
          'content-type': 'application/json',
          prefer: input.prefer === undefined ? PREFER_IMMUTABLE_IDS : `${PREFER_IMMUTABLE_IDS}, ${input.prefer}`
        },
        method: input.method,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      return Result.ok(response);
    } catch {
      return Result.err({ kind: 'provider-unavailable', message: 'Exchange could not be reached' });
    }
  }

  /**
   * Deleted between the delta page and this read means nothing is left to announce, which is the
   * `undefined` branch — failing the poll instead would pin the cursor on a message that will 404
   * forever.
   */
  private async fetchArrival(ref: MailMessageRef): Promise<Result<MailArrival | undefined, MailFailure.Poll>> {
    const fetched = await this.getJson(
      { query: { $select: ARRIVAL_SELECT }, ref, segments: ['messages', ref] },
      $GraphMessage
    );
    if (fetched.success) {
      const message = fetched.value;
      return Result.ok({
        body: renderGraphBody(message.body),
        receivedAt: message.receivedDateTime,
        ref: message.id,
        sender: toSenderParty(message),
        subject: message.subject
      });
    }
    const failure = match(fetched.error)
      .with({ kind: 'not-found' }, () => undefined)
      .with({ kind: 'auth' }, (refused): MailFailure.Poll => refused)
      .with({ kind: 'provider-unavailable' }, (unavailable): MailFailure.Poll => unavailable)
      .with({ kind: 'rejected' }, ({ message }): MailFailure.Poll => ({ kind: 'provider-unavailable', message }))
      .exhaustive();
    return failure === undefined ? Result.ok(undefined) : Result.err(failure);
  }

  /**
   * §6.7 on the one call that commits: a thrown fetch may have reached Exchange, so it is
   * unresolved, never a failure; a 4xx is the server refusing before acting; a 5xx is the server
   * failing while acting, which is unknowable either way. Nothing here is ever retried.
   */
  private async finishSend(
    dispatched: Result<Response, MailFailure.Auth | MailFailure.ProviderUnavailable>
  ): Promise<Result<void, MailFailure.Send>> {
    if (!dispatched.success) {
      if (dispatched.error.kind === 'auth') {
        return dispatched;
      }
      return Result.err({
        kind: 'send-unresolved',
        message: 'the send may or may not have left; Exchange stopped answering'
      });
    }
    const response = dispatched.value;
    if (response.ok) {
      return Result.ok();
    }
    const body = await response.text().catch(() => undefined);
    const detail = body === undefined ? `status ${response.status}` : `status ${response.status}: ${body}`;
    if (response.status === 401 || response.status === 403) {
      return Result.err({ kind: 'auth', message: `Exchange refused the request (${detail})` });
    }
    if (response.status >= 500) {
      return Result.err({ kind: 'send-unresolved', message: `Exchange failed while sending (${detail})` });
    }
    return Result.err({ kind: 'send-refused', message: `Exchange refused the send (${detail})` });
  }

  private async getDeltaPage(link: string, pageSize: number): Promise<Result<$GraphDeltaPage, MailFailure.Poll>> {
    const dispatched = await this.dispatch({
      method: 'GET',
      prefer: `odata.maxpagesize=${pageSize}`,
      url: new URL(link)
    });
    if (!dispatched.success) {
      return dispatched;
    }
    const response = dispatched.value;
    if (response.status === 410) {
      return Result.err({ kind: 'cursor-reset', message: 'Exchange expired the delta token' });
    }
    if (!response.ok) {
      const body = await response.text().catch(() => undefined);
      const detail = body === undefined ? `status ${response.status}` : `status ${response.status}: ${body}`;
      if (response.status === 401 || response.status === 403) {
        return Result.err({ kind: 'auth', message: `Exchange refused the request (${detail})` });
      }
      return Result.err({ kind: 'provider-unavailable', message: `Exchange answered ${detail}` });
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return Result.err({ kind: 'provider-unavailable', message: 'the Exchange response could not be read' });
    }
    const parsed = $GraphDeltaPage.safeParse(body);
    if (!parsed.success) {
      return Result.err({ kind: 'provider-unavailable', message: 'Exchange answered with a malformed body' });
    }
    return Result.ok(parsed.data);
  }

  private getJson<TValue>(
    input: { query: { [param: string]: string }; ref?: MailMessageRef; segments: readonly string[] },
    schema: z.ZodType<TValue>
  ): Promise<Result<TValue, MailFailure.Read>> {
    return this.readJson(this.graphUrl(input.segments, input.query), schema, input.ref);
  }

  /**
   * The path arrives as segments and every one of them is encoded, so a ref cannot become anything
   * but a ref. Refs reach here straight from LLM tool arguments on the ungated read actions, and a
   * `/`, `..`, `?` or `#` inside one would otherwise re-point a request carrying this app's Graph
   * token at another endpoint entirely. Graph's own ids need the encoding regardless: outside the
   * immutable-id form they contain `/` and `=`.
   */
  private graphUrl(segments: readonly string[], query: { [param: string]: string }): URL {
    const path = [this.address, ...segments].map((segment) => encodeURIComponent(segment)).join('/');
    const url = new URL(`${GRAPH_BASE_URL}/users/${path}`);
    for (const [param, value] of Object.entries(query)) {
      url.searchParams.set(param, value);
    }
    return url;
  }

  private async readJson<TValue>(
    url: URL,
    schema: z.ZodType<TValue>,
    ref?: MailMessageRef,
    method: 'GET' | 'POST' = 'GET'
  ): Promise<Result<TValue, MailFailure.Read>> {
    const dispatched = await this.dispatch({ method, url });
    if (!dispatched.success) {
      return dispatched;
    }
    if (!dispatched.value.ok) {
      return this.classifyFailure(dispatched.value, ref);
    }
    let body: unknown;
    try {
      body = await dispatched.value.json();
    } catch {
      return Result.err({ kind: 'provider-unavailable', message: 'the Exchange response could not be read' });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return Result.err({ kind: 'provider-unavailable', message: 'Exchange answered with a malformed body' });
    }
    return Result.ok(parsed.data);
  }
}
