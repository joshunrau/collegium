import { decodeHtmlEntities } from '../web.utils.ts';

import type { TlsReason, WebFailure } from '../web.types.ts';

const HTML_TYPES: ReadonlySet<string> = new Set(['application/xhtml+xml', 'text/html']);

const TEXT_TYPES: ReadonlySet<string> = new Set(['application/json', 'application/xml']);

const TITLE_PATTERN = /<title[^>]*>([^<]*)<\/title>/i;

/** OpenSSL's and Node's names for a certificate that did not verify, by what each establishes (§3.4) */
const TLS_REASONS_BY_CODE: { readonly [code: string]: TlsReason } = {
  CERT_HAS_EXPIRED: 'expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'self-signed',
  ERR_TLS_CERT_ALTNAME_INVALID: 'name-mismatch',
  HOSTNAME_MISMATCH: 'name-mismatch',
  SELF_SIGNED_CERT_IN_CHAIN: 'untrusted-issuer',
  UNABLE_TO_GET_ISSUER_CERT: 'untrusted-issuer',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'untrusted-issuer',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'incomplete-chain'
};

/** the rest of the handshake's failures, named but not classified */
const TLS_CODE_PREFIXES = ['CERT_', 'ERR_OSSL_', 'ERR_SSL_', 'ERR_TLS_', 'UNABLE_TO_'];

function asTlsFailure(error: unknown): undefined | WebFailure.Tls {
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  if (code === undefined) {
    return undefined;
  }
  const reason =
    TLS_REASONS_BY_CODE[code] ?? (TLS_CODE_PREFIXES.some((prefix) => code.startsWith(prefix)) ? 'unclassified' : undefined);
  return reason === undefined ? undefined : { code, kind: 'tls', reason };
}

function mediaTypeOf(contentType: string): string {
  return contentType.split(';')[0]!.trim().toLowerCase();
}

/** an absent header is read as HTML — the web's default, and what the accept header asked for first */
export function classifyContentType(contentType: string): 'html' | 'text' | 'unsupported' {
  const mediaType = mediaTypeOf(contentType);
  if (mediaType === '' || HTML_TYPES.has(mediaType)) {
    return 'html';
  }
  if (
    mediaType.startsWith('text/') ||
    TEXT_TYPES.has(mediaType) ||
    mediaType.endsWith('+json') ||
    mediaType.endsWith('+xml')
  ) {
    return 'text';
  }
  return 'unsupported';
}

export function charsetOf(contentType: string): string {
  const parameter = /;\s*charset=("?)([^";\s]+)\1/i.exec(contentType);
  return parameter?.[2]?.toLowerCase() ?? 'utf-8';
}

export function extractTitle(html: string): string {
  return decodeHtmlEntities(TITLE_PATTERN.exec(html)?.[1]?.trim() ?? '');
}

/** a charset the runtime does not know is read as UTF-8 rather than refused — the body is still mostly ASCII markup */
export function toDecoder(charset: string): TextDecoder {
  try {
    return new TextDecoder(charset);
  } catch {
    return new TextDecoder();
  }
}

/** a lookup or socket error names its reason — ENOTFOUND, ECONNREFUSED — while an abort keeps its reason in `cause` */
export function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

/**
 * A failed request in the app's words. A TLS failure is classified by its code and never by its
 * message, because Node's message for an unverifiable chain carries advice about the runtime's own
 * flags, which a model reads as a fault in this deployment (§3.4).
 */
export function classifyFetchError(error: unknown): WebFailure.Navigation | WebFailure.Tls {
  return asTlsFailure(error) ?? { kind: 'navigation', message: describeFetchError(error) };
}
