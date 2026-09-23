const LINE_HEIGHT = 14;

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

/**
 * A minimal, valid PDF: one page per entry, each line of ASCII set in Helvetica, so a test holds a
 * document it wrote itself rather than one taken from anywhere.
 */
export function createPdf(pages: readonly (readonly string[])[]): Uint8Array {
  const fontId = 3 + pages.length * 2;
  const pageIds = pages.map((_, index) => 3 + index * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    ...pages.flatMap((lines, index) => {
      const content = toContentStream(lines);
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> ` +
          `/Contents ${pageIds[index]! + 1} 0 R >>`,
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
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
  return new TextEncoder().encode(document);
}
