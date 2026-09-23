import { describe, expect, it } from 'vitest';

import { createPdf } from '@/testing/factories/pdf.factory.ts';

import { UnpdfTextExtractor } from '../unpdf.extractor.ts';

const HANDBOOK = createPdf([['Faculty Handbook', 'Contents'], [], ['Duval, P. (duval@northmoor.example)']]);

const UNBOUNDED = { deadline: new AbortController().signal, maxChars: Number.POSITIVE_INFINITY };

describe('UnpdfTextExtractor', () => {
  const extractor = new UnpdfTextExtractor();

  it("should read each page's text layer in page order, a page drawn without text as empty", async () => {
    const result = await extractor.extract(HANDBOOK, UNBOUNDED);
    expect(result.value).toStrictEqual({
      pageCount: 3,
      pages: ['Faculty Handbook\nContents', '', 'Duval, P. (duval@northmoor.example)']
    });
  });

  it('should leave the bytes it was handed readable', async () => {
    const bytes = createPdf([['Faculty Handbook']]);
    await extractor.extract(bytes, UNBOUNDED);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it('should stop at the page boundary after the text passes its budget', async () => {
    const result = await extractor.extract(HANDBOOK, { ...UNBOUNDED, maxChars: 10 });
    expect(result.value).toStrictEqual({
      pageCount: 3,
      pages: ['Faculty Handbook\nContents'],
      stoppedBy: 'char-limit'
    });
  });

  it('should stop after the first page once its deadline has passed', async () => {
    const result = await extractor.extract(HANDBOOK, { ...UNBOUNDED, deadline: AbortSignal.abort() });
    expect(result.value).toMatchObject({ pages: ['Faculty Handbook\nContents'], stoppedBy: 'deadline' });
  });

  it('should report bytes that do not parse as a PDF as malformed', async () => {
    const result = await extractor.extract(new TextEncoder().encode('<!doctype html><h1>Not Found</h1>'), UNBOUNDED);
    expect(result.error).toBe('malformed');
  });
});
