const HTML_TYPES: ReadonlySet<string> = new Set(['application/xhtml+xml', 'text/html']);

const TEXT_TYPES: ReadonlySet<string> = new Set(['application/json', 'application/xml']);

const TITLE_PATTERN = /<title[^>]*>([^<]*)<\/title>/i;

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
  return TITLE_PATTERN.exec(html)?.[1]?.trim() ?? '';
}

/**
 * The one verdict on whether a fetched document is readable without a browser. A refusal here
 * costs the model one `navigate`; a pass on a hollow page has it reasoning over nothing — so the
 * bias is toward refusing, and richer signals (an empty mount root beside scripts, a `noscript`
 * apology) belong here and nowhere else.
 */
export function needsClientRendering(markdown: string): boolean {
  return markdown === '';
}

/** a charset the runtime does not know is read as UTF-8 rather than refused — the body is still mostly ASCII markup */
export function toDecoder(charset: string): TextDecoder {
  try {
    return new TextDecoder(charset);
  } catch {
    return new TextDecoder();
  }
}

/** undici reports every network error as a bare "fetch failed" and keeps the reason — ENOTFOUND, ECONNREFUSED — in `cause` */
export function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}
