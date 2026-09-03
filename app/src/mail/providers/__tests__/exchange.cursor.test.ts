import { Result } from '@collegium/core/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExchangeMailProvider } from '../exchange.provider.ts';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const DELTA_LINK = 'https://graph.microsoft.com/v1.0/users/x/mailFolders/inbox/messages/delta?$deltatoken=round-2';
const NEXT_LINK = 'https://graph.microsoft.com/v1.0/users/x/mailFolders/inbox/messages/delta?$skiptoken=page-2';

const cursorOf = (overrides: { [key: string]: unknown } = {}) => {
  return JSON.stringify({
    boundaryIds: ['msg-boundary'],
    link: DELTA_LINK,
    watermark: '2026-07-30T12:00:00.000Z',
    ...overrides
  });
};

describe('ExchangeMailProvider cursor', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const getAccessToken = vi.fn();
  let provider: ExchangeMailProvider;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    getAccessToken.mockResolvedValue(Result.ok('token-1'));
    provider = new ExchangeMailProvider('tess.rivera@example.org', { getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should walk the whole delta at first connection, keeping the high-water mark and returning no mail', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        '@odata.nextLink': NEXT_LINK,
        value: [{ id: 'msg-old', receivedDateTime: '2026-07-29T09:00:00Z' }]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        '@odata.deltaLink': DELTA_LINK,
        value: [{ id: 'msg-newest', receivedDateTime: '2026-07-30T12:00:00Z' }]
      })
    );
    const initialized = await provider.initializeCursor();
    expect(JSON.parse(initialized.value!)).toStrictEqual({
      boundaryIds: ['msg-newest'],
      link: DELTA_LINK,
      watermark: '2026-07-30T12:00:00.000Z'
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      prefer: 'IdType="ImmutableId", odata.maxpagesize=100'
    });
  });

  it('should announce only arrivals past the watermark, fetched in full and oldest first', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        '@odata.deltaLink': DELTA_LINK.replace('round-2', 'round-3'),
        value: [
          { id: 'msg-old-update', receivedDateTime: '2026-07-30T08:00:00Z' },
          { id: 'msg-boundary', receivedDateTime: '2026-07-30T12:00:00Z' },
          { '@removed': { reason: 'deleted' }, id: 'msg-tombstone' },
          { id: 'msg-new-2', receivedDateTime: '2026-07-31T10:00:00Z' },
          { id: 'msg-new-1', receivedDateTime: '2026-07-31T09:00:00Z' }
        ]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        body: { content: 'second', contentType: 'text' },
        from: { emailAddress: { address: 'a@acme.com' } },
        id: 'msg-new-2',
        receivedDateTime: '2026-07-31T10:00:00Z',
        subject: 'Second'
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        body: { content: 'first', contentType: 'text' },
        from: { emailAddress: { address: 'a@acme.com' } },
        id: 'msg-new-1',
        receivedDateTime: '2026-07-31T09:00:00Z',
        subject: 'First'
      })
    );
    const polled = await provider.pollNew(cursorOf(), 25);
    expect(polled.value?.messages.map(({ ref }) => ref)).toStrictEqual(['msg-new-1', 'msg-new-2']);
    expect(polled.value?.messages[0]).toMatchObject({ body: 'first', sender: { address: 'a@acme.com' } });
    expect(JSON.parse(polled.value!.cursor)).toMatchObject({ link: DELTA_LINK.replace('round-2', 'round-3') });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      prefer: 'IdType="ImmutableId", odata.maxpagesize=25'
    });
  });

  it('should keep a mid-round next link as the cursor while a backlog drains', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ '@odata.nextLink': NEXT_LINK, value: [] }));
    const polled = await provider.pollNew(cursorOf(), 25);
    expect(polled.value?.messages).toStrictEqual([]);
    expect(JSON.parse(polled.value!.cursor)).toMatchObject({ link: NEXT_LINK });
  });

  it('should skip an arrival deleted before it could be read, still advancing the cursor', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        '@odata.deltaLink': DELTA_LINK,
        value: [{ id: 'msg-fleeting', receivedDateTime: '2026-07-31T09:00:00Z' }]
      })
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'ErrorItemNotFound' } }, 404));
    const polled = await provider.pollNew(cursorOf(), 25);
    expect(polled.value?.messages).toStrictEqual([]);
    expect(polled.success).toBe(true);
  });

  it('should report an expired delta token as cursor-reset', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'SyncStateNotFound' } }, 410));
    expect((await provider.pollNew(cursorOf(), 25)).error).toMatchObject({ kind: 'cursor-reset' });
  });

  it('should report an unreadable stored cursor as cursor-reset', async () => {
    expect((await provider.pollNew('not json', 25)).error).toMatchObject({ kind: 'cursor-reset' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
