import { constants, deflateRawSync, deflateSync } from 'node:zlib';

const LINE_HEIGHT = 14;

const MEBIBYTE = 2 ** 20;

/** how far back a Flate stream may refer, so a window this long of zeros is all the history a mebibyte of zeros sees */
const DEFLATE_WINDOW_BYTES = 32 * 1024;

const ADLER_MODULUS = 65_521;

/** saves and restores of the graphics state, a few kilobytes of Flate for a million: PDF.js takes a fraction of a second to walk them */
const SLOW_CONTENT_OPERATORS = 'q Q '.repeat(1_000_000);

function escapePdfString(text: string): string {
  return text.replaceAll(/[\\()]/g, (character) => `\\${character}`);
}

/** a page with lines is drawn as text; a page with none is a filled rectangle, as a scan's image carries no text */
function toContentStream(lines: readonly string[]): string {
  if (lines.length === 0) {
    return '0.5 g 72 72 468 648 re f';
  }
  const shown = lines.map((line) => `(${escapePdfString(line)}) Tj T*`).join(' ');
  return `BT /F1 12 Tf ${LINE_HEIGHT} TL 72 720 Td ${shown} ET`;
}

/** each page's content stream, one byte to a character, and the dictionary entries that describe it */
type PageContent = { entries: string; stream: string };

function assemblePdf(contents: readonly PageContent[]): Uint8Array {
  const fontId = 3 + contents.length * 2;
  const pageIds = contents.map((_, index) => 3 + index * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${contents.length} >>`,
    ...contents.flatMap(({ entries, stream }, index) => {
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> ` +
          `/Contents ${pageIds[index]! + 1} 0 R >>`,
        `<< /Length ${stream.length}${entries} >>\nstream\n${stream}\nendstream`
      ];
    }),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let document = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(document.length);
    document += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(document, 'latin1'));
}

/**
 * A minimal, valid PDF: one page per entry, each line of ASCII set in Helvetica, so a test holds a
 * document it wrote itself rather than one taken from anywhere.
 */
export function createPdf(pages: readonly (readonly string[])[]): Uint8Array {
  return assemblePdf(pages.map((lines) => ({ entries: '', stream: toContentStream(lines) })));
}

/**
 * A PDF whose first page reads at once and whose every page after it keeps the reader busy for a
 * fraction of a second without costing it memory, so a read of it outlasts a short deadline.
 */
export function createSlowPdf(slowPages: number): Uint8Array {
  const first = { entries: '', stream: toContentStream(['Faculty Handbook']) };
  const slow = { entries: ' /Filter /FlateDecode', stream: deflateSync(SLOW_CONTENT_OPERATORS).toString('latin1') };
  return assemblePdf([first, ...Array.from({ length: slowPages }, () => slow)]);
}

/**
 * A one-page PDF whose content stream is about a kilobyte of Flate for every mebibyte of zeros it
 * inflates to, written without ever holding the zeros: past the first mebibyte, each one deflates
 * against a window of zeros to the same bytes, so the stream is those bytes repeated.
 */
export function createDecompressionBombPdf(inflatedMebibytes: number): Uint8Array {
  const zeros = new Uint8Array(MEBIBYTE);
  const first = deflateRawSync(zeros, { finishFlush: constants.Z_SYNC_FLUSH });
  const next = deflateRawSync(zeros, {
    dictionary: zeros.subarray(0, DEFLATE_WINDOW_BYTES),
    finishFlush: constants.Z_SYNC_FLUSH
  });
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((((inflatedMebibytes * MEBIBYTE) % ADLER_MODULUS) * 2 ** 16 + 1) >>> 0);
  const zlibHeader = Buffer.from([0x78, 0x9c]);
  const finalEmptyBlock = Buffer.from([0x01, 0x00, 0x00, 0xff, 0xff]);
  const stream = Buffer.concat([
    zlibHeader,
    first,
    ...Array.from({ length: inflatedMebibytes - 1 }, () => next),
    finalEmptyBlock,
    checksum
  ]);
  return assemblePdf([{ entries: ' /Filter /FlateDecode', stream: stream.toString('latin1') }]);
}
