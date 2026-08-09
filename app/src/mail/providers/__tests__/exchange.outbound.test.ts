import { Result } from '@collegium/core/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExchangeMailProvider } from '../exchange.provider.ts';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const OUTBOUND = {
  body: 'The invoice is scheduled for Friday.',
  cc: ['ops@example.org'],
  subject: 'Re: Invoice overdue',
  to: ['billing@acme.com']
} as const;

const GRAPH_OUTBOUND = {
  body: { content: 'The invoice is scheduled for Friday.', contentType: 'text' },
  ccRecipients: [{ emailAddress: { address: 'ops@example.org' } }],
  subject: 'Re: Invoice overdue',
  toRecipients: [{ emailAddress: { address: 'billing@acme.com' } }]
};

describe('ExchangeMailProvider outbound', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const getAccessToken = vi.fn();
  let provider: ExchangeMailProvider;

  const requested = (call: number) => {
    const [target, init] = fetchMock.mock.calls[call] ?? [];
    return { body: init?.body, method: init?.method, url: String(target instanceof URL ? target : '') };
  };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    getAccessToken.mockResolvedValue(Result.ok('token-1'));
    provider = new ExchangeMailProvider('tess.rivera@example.org', { getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should send exactly the given recipients, subject, and body via sendMail', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));
    expect((await provider.send(OUTBOUND)).success).toBe(true);
    expect(requested(0).url).toContain('/sendMail');
    expect(requested(0).body).toBe(JSON.stringify({ message: GRAPH_OUTBOUND, saveToSentItems: true }));
  });

  it('should reply by overwriting the provider-built draft with the approved content, then sending it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'draft-1' }, 201));
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 200));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));
    expect((await provider.reply('msg-1', OUTBOUND)).success).toBe(true);
    expect(requested(0).url).toContain('/messages/msg-1/createReply');
    expect(requested(1)).toMatchObject({ body: JSON.stringify(GRAPH_OUTBOUND), method: 'PATCH' });
    expect(requested(2).url).toContain('/messages/draft-1/send');
  });

  it('should remove the stray draft and send nothing when the overwrite fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'draft-1' }, 201));
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'ErrorInvalidRecipients' } }, 400));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const replied = await provider.reply('msg-1', OUTBOUND);
    expect(replied.error).toMatchObject({ kind: 'rejected' });
    expect(requested(2).method).toBe('DELETE');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('should report a 4xx on the send itself as refused — it definitively did not leave', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'ErrorSendAsDenied' } }, 400));
    expect((await provider.send(OUTBOUND)).error).toMatchObject({ kind: 'send-refused' });
  });

  it('should report a 5xx on the send itself as unresolved, never as a failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'InternalServerError' } }, 500));
    expect((await provider.send(OUTBOUND)).error).toMatchObject({ kind: 'send-unresolved' });
  });

  it('should report a dropped connection on the send itself as unresolved', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    expect((await provider.send(OUTBOUND)).error).toMatchObject({ kind: 'send-unresolved' });
  });
});
