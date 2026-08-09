import { Result } from '@collegium/core/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExchangeMailProvider } from '../exchange.provider.ts';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const graphMessage = (overrides: { [key: string]: unknown } = {}) => ({
  bodyPreview: 'Please pay invoice 42',
  from: { emailAddress: { address: 'billing@acme.com', name: 'Acme Billing' } },
  id: 'msg-1',
  isRead: false,
  receivedDateTime: '2026-07-30T12:00:00Z',
  subject: 'Invoice overdue',
  ...overrides
});

describe('ExchangeMailProvider', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const getAccessToken = vi.fn();
  let provider: ExchangeMailProvider;

  const requestedUrl = (call = 0) => {
    const target = fetchMock.mock.calls[call]?.[0];
    if (!(target instanceof URL)) {
      expect.fail('expected the request target to be a URL');
    }
    return target.toString();
  };
  const requestedInit = (call = 0) => fetchMock.mock.calls[call]?.[1];

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    getAccessToken.mockResolvedValue(Result.ok('token-1'));
    provider = new ExchangeMailProvider('tess.rivera@example.org', { getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should list the inbox newest first, as summaries with no body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ value: [graphMessage()] }));
    const listed = await provider.listRecent(5);
    expect(listed.value).toStrictEqual([
      {
        isRead: false,
        preview: 'Please pay invoice 42',
        receivedAt: new Date('2026-07-30T12:00:00Z'),
        ref: 'msg-1',
        sender: { address: 'billing@acme.com', name: 'Acme Billing' },
        subject: 'Invoice overdue'
      }
    ]);
    expect(requestedUrl()).toContain('/users/tess.rivera%40example.org/mailFolders/inbox/messages');
    expect(requestedUrl()).toContain('%24top=5');
    expect(requestedInit()?.headers).toMatchObject({ prefer: 'IdType="ImmutableId"' });
  });

  it('should search with the query quoted and escaped', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ value: [] }));
    expect((await provider.search('invoice "42"', 10)).value).toStrictEqual([]);
    const url = new URL(requestedUrl());
    expect(url.searchParams.get('$search')).toBe('"invoice \\"42\\""');
  });

  it('should gather a conversation oldest first, whatever order Graph returns', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(graphMessage({ conversationId: 'conv-1' })));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        value: [graphMessage({ id: 'msg-2', receivedDateTime: '2026-07-30T14:00:00Z' }), graphMessage({ id: 'msg-1' })]
      })
    );
    const thread = await provider.getConversation('msg-1');
    expect(thread.value?.map(({ ref }) => ref)).toStrictEqual(['msg-1', 'msg-2']);
    expect(new URL(requestedUrl(1)).searchParams.get('$filter')).toBe("conversationId eq 'conv-1'");
  });

  it('should open a message, rendering its HTML body as markdown and describing attachments', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        graphMessage({
          body: { content: '<p>Hello <b>world</b></p>', contentType: 'html' },
          ccRecipients: [{ emailAddress: { address: 'ops@example.org' } }],
          hasAttachments: true,
          toRecipients: [{ emailAddress: { address: 'tess.rivera@example.org', name: 'Tess Rivera' } }]
        })
      )
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ value: [{ contentType: 'application/pdf', name: 'invoice.pdf', size: 12_345 }] })
    );
    const opened = await provider.open('msg-1');
    expect(opened.value).toMatchObject({
      attachments: [{ name: 'invoice.pdf', size: 12_345, type: 'application/pdf' }],
      body: 'Hello **world**',
      cc: [{ address: 'ops@example.org' }],
      to: [{ address: 'tess.rivera@example.org', name: 'Tess Rivera' }]
    });
  });

  it('should pass a plain-text body through and skip the attachment call when there are none', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(graphMessage({ body: { content: 'plain words', contentType: 'text' } }))
    );
    const opened = await provider.open('msg-1');
    expect(opened.value?.body).toBe('plain words');
    expect(opened.value?.attachments).toStrictEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should mark a message read with a PATCH', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 200));
    expect((await provider.markRead('msg-1')).success).toBe(true);
    expect(requestedInit()?.method).toBe('PATCH');
    expect(requestedInit()?.body).toBe('{"isRead":true}');
  });

  it('should report a ref Graph does not know as not-found', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'ErrorItemNotFound' } }, 404));
    expect((await provider.open('msg-gone')).error).toStrictEqual({ kind: 'not-found', ref: 'msg-gone' });
  });

  it('should report a 403 as an auth failure, since the RBAC scope decides access', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'ErrorAccessDenied' } }, 403));
    expect((await provider.listRecent(5)).error).toMatchObject({ kind: 'auth' });
  });

  it('should short-circuit on a token failure without touching Graph', async () => {
    getAccessToken.mockResolvedValue(Result.err({ kind: 'auth', message: 'the secret expired' }));
    expect((await provider.listRecent(5)).error).toMatchObject({ kind: 'auth' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should probe by reading the inbox folder itself', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'inbox' }));
    expect((await provider.probe()).success).toBe(true);
    expect(requestedUrl()).toContain('/mailFolders/inbox');
  });
});
