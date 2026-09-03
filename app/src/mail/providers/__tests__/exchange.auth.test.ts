import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExchangeAuth } from '../exchange.auth.ts';

const tokenResponse = (token: string, expiresInSeconds = 3600) => {
  return new Response(JSON.stringify({ access_token: token, expires_in: expiresInSeconds }), { status: 200 });
};

describe('ExchangeAuth', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let auth: ExchangeAuth;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    auth = new ExchangeAuth({ clientId: 'client_1', clientSecret: 'secret_1', tenantId: 'tenant_1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should request a token from the tenant endpoint with the client-credentials grant', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('token-1'));
    expect((await auth.getAccessToken()).value).toBe('token-1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://login.microsoftonline.com/tenant_1/oauth2/v2.0/token');
    const body = init?.body;
    if (!(body instanceof URLSearchParams)) {
      expect.fail('expected a URLSearchParams body');
    }
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('scope')).toBe('https://graph.microsoft.com/.default');
  });

  it('should serve the cached token without a second request', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('token-1'));
    await auth.getAccessToken();
    expect((await auth.getAccessToken()).value).toBe('token-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should refresh a token already inside the expiry skew', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('token-1', 60));
    fetchMock.mockResolvedValueOnce(tokenResponse('token-2'));
    await auth.getAccessToken();
    expect((await auth.getAccessToken()).value).toBe('token-2');
  });

  it('should report refused credentials as an auth failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"invalid_client"}', { status: 401 }));
    expect((await auth.getAccessToken()).error).toMatchObject({ kind: 'auth' });
  });

  it('should report an unreachable token endpoint as provider-unavailable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect((await auth.getAccessToken()).error).toMatchObject({ kind: 'provider-unavailable' });
  });

  it('should report a malformed token response as provider-unavailable', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"unexpected":true}', { status: 200 }));
    expect((await auth.getAccessToken()).error).toMatchObject({ kind: 'provider-unavailable' });
  });
});
