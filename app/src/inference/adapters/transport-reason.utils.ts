import type { InferenceFailure, TransportReason } from '../inference.types.ts';

/** the undici and libuv codes a failed fetch carries on its cause, mapped to the coarse reasons a post may name (§3.2) */
const REASONS_BY_CODE: { readonly [code: string]: TransportReason } = {
  EAI_AGAIN: 'dns',
  ECONNREFUSED: 'refused',
  ECONNRESET: 'reset',
  EHOSTUNREACH: 'refused',
  ENOTFOUND: 'dns',
  EPIPE: 'reset',
  ETIMEDOUT: 'connect_timeout',
  UND_ERR_BODY_TIMEOUT: 'response_timeout',
  UND_ERR_CONNECT_TIMEOUT: 'connect_timeout',
  UND_ERR_HEADERS_TIMEOUT: 'response_timeout',
  UND_ERR_SOCKET: 'reset'
};

const TLS_CODE_PREFIXES = [
  'CERT_',
  'DEPTH_ZERO_',
  'ERR_OSSL_',
  'ERR_SSL_',
  'ERR_TLS_',
  'HOSTNAME_MISMATCH',
  'SELF_SIGNED_',
  'UNABLE_TO_'
];

/** the runtime abort — the framework's own inference timeout firing — is a response that never came, since undici bounds connecting on its own */
const ABORT_ERROR_NAMES = new Set(['AbortError', 'TimeoutError']);

const codeOf = (error: unknown): string | undefined => {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const cause: unknown = error.cause;
  if (cause instanceof Error && 'code' in cause && typeof cause.code === 'string') {
    return cause.code;
  }
  return 'code' in error && typeof error.code === 'string' ? error.code : undefined;
};

const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause: unknown = error.cause;
  const causeText = cause instanceof Error ? ` (cause: ${cause.message})` : '';
  return `${error.name}: ${error.message}${causeText}`;
};

const toReason = (error: unknown): TransportReason => {
  if (error instanceof Error && ABORT_ERROR_NAMES.has(error.name)) {
    return 'response_timeout';
  }
  const code = codeOf(error);
  if (code === undefined) {
    return 'unknown';
  }
  if (TLS_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))) {
    return 'tls';
  }
  return REASONS_BY_CODE[code] ?? 'unknown';
};

/** what a rejected fetch, or a body that failed mid-read, says about why the provider was not reached */
export function classifyTransportError(error: unknown): InferenceFailure.Transport {
  return { detail: describeError(error), kind: 'transport', reason: toReason(error) };
}
