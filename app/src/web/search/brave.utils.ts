const NAMED_REFERENCES = new Map([
  ['amp', '&'],
  ['apos', "'"],
  ['gt', '>'],
  ['lt', '<'],
  ['quot', '"']
]);

const CHARACTER_REFERENCE = /&(#\d+|#x[0-9a-f]+|[a-z]+);/giu;

const MAX_CODE_POINT = 0x10_ff_ff;

function toCodePoint(body: string): number {
  return body[1]?.toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
}

/**
 * The provider hands back HTML-escaped snippets, so `&#x27;` reaches the model where an apostrophe
 * belongs. Decoding is the adapter's, since the encoding is the vendor's; a reference this does not
 * know is left as it arrived rather than guessed at.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replaceAll(CHARACTER_REFERENCE, (reference: string, body: string) => {
    if (!body.startsWith('#')) {
      return NAMED_REFERENCES.get(body.toLowerCase()) ?? reference;
    }
    const codePoint = toCodePoint(body);
    return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= MAX_CODE_POINT
      ? String.fromCodePoint(codePoint)
      : reference;
  });
}
