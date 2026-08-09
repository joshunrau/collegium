import { Result } from '@collegium/core/utils';

import { $ExchangeTokenResponse } from './exchange.schemas.ts';

import type { MailFailure } from '../mail.types.ts';

/** refresh this long before expiry, so a token is never presented in its dying seconds */
const EXPIRY_SKEW_MS = 120_000;

const TOKEN_TIMEOUT_MS = 15_000;

type ExchangeAuthConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tenantId: string;
};

/**
 * The client-credentials flow against Entra, hand-rolled: one POST, one cached token. The token
 * carries no roles claim by design — authorisation lives in Exchange App RBAC, scoped to the one
 * mailbox — so possessing it grants nothing an Exchange assignment did not.
 */
export class ExchangeAuth {
  private cached: undefined | { expiresAt: number; token: string };
  private readonly config: ExchangeAuthConfig;

  constructor(config: ExchangeAuthConfig) {
    this.config = config;
  }

  async getAccessToken(): Promise<Result<string, MailFailure.Probe>> {
    if (this.cached && Date.now() < this.cached.expiresAt) {
      return Result.ok(this.cached.token);
    }
    const posted = await this.post();
    if (!posted.success) {
      return posted;
    }
    const read = await this.readToken(posted.value);
    if (!read.success) {
      return read;
    }
    this.cached = {
      expiresAt: Date.now() + read.value.expiresIn * 1000 - EXPIRY_SKEW_MS,
      token: read.value.accessToken
    };
    return Result.ok(this.cached.token);
  }

  private async classifyFailure(response: Response): Promise<Result<never, MailFailure.Probe>> {
    const body = await response.text().catch(() => undefined);
    const detail = body === undefined ? `status ${response.status}` : `status ${response.status}: ${body}`;
    if (response.status >= 500 || response.status === 429) {
      return Result.err({ kind: 'provider-unavailable', message: `the token endpoint answered ${detail}` });
    }
    return Result.err({ kind: 'auth', message: `Entra refused the credentials (${detail})` });
  }

  private async post(): Promise<Result<Response, MailFailure.ProviderUnavailable>> {
    try {
      const response = await fetch(`https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`, {
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          grant_type: 'client_credentials',
          scope: 'https://graph.microsoft.com/.default'
        }),
        method: 'POST',
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS)
      });
      return Result.ok(response);
    } catch {
      return Result.err({ kind: 'provider-unavailable', message: 'the token endpoint could not be reached' });
    }
  }

  private async readToken(response: Response): Promise<Result<$ExchangeTokenResponse, MailFailure.Probe>> {
    if (!response.ok) {
      return this.classifyFailure(response);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return Result.err({ kind: 'provider-unavailable', message: 'the token response could not be read' });
    }
    const parsed = $ExchangeTokenResponse.safeParse(body);
    if (!parsed.success) {
      return Result.err({ kind: 'provider-unavailable', message: 'the token response was malformed' });
    }
    return Result.ok(parsed.data);
  }
}
