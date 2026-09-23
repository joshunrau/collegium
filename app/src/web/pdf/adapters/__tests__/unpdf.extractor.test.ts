import { describe, expect, it } from 'vitest';

import { createDecompressionBombPdf, createPdf, createSlowPdf } from '@/testing/factories/pdf.factory.ts';

import { MARKDOWN_CAP_CHARS } from '../../../web.constants.ts';
import { UnpdfTextExtractor } from '../unpdf.extractor.ts';

import type { PdfReadBudget } from '../../pdf.types.ts';

const HANDBOOK = createPdf([['Faculty Handbook', 'Contents'], [], ['Duval, P. (duval@northmoor.example)']]);

/** a page of text and then pages the reader takes seconds to get through, far past any deadline here */
const SLOW_HANDBOOK = createSlowPdf(40);

/** well above what the reader takes for an ordinary document, and far below what the bomb inflates to */
const TEST_MEMORY_CAP_BYTES = 256 * 2 ** 20;

function createExtractor(readsAtOnce = 2): UnpdfTextExtractor {
  return new UnpdfTextExtractor({ memoryCapBytes: TEST_MEMORY_CAP_BYTES, readsAtOnce });
}

function createBudget(deadline = new AbortController().signal): PdfReadBudget {
  return { deadline, maxChars: MARKDOWN_CAP_CHARS };
}

describe('UnpdfTextExtractor', () => {
  it("should read each page's text layer in page order, a page drawn without text as empty", async () => {
    const result = await createExtractor().extract(HANDBOOK, createBudget());
    expect(result.value).toStrictEqual({
      pageCount: 3,
      pages: ['Faculty Handbook\nContents', '', 'Duval, P. (duval@northmoor.example)']
    });
  });

  it('should stop at the page boundary after the text passes its budget', async () => {
    const pdf = createPdf([['Faculty Handbook'], ['Contents'], ['Index']]);
    const result = await createExtractor().extract(pdf, { ...createBudget(), maxChars: 20 });
    expect(result.value).toStrictEqual({
      pageCount: 3,
      pages: ['Faculty Handbook', 'Contents'],
      stoppedBy: 'char-limit'
    });
  });

  it('should keep the pages read by its deadline (§3.4)', async () => {
    const result = await createExtractor().extract(SLOW_HANDBOOK, createBudget(AbortSignal.timeout(2_000)));
    expect(result.value).toMatchObject({ pageCount: 41, stoppedBy: 'deadline' });
    expect(result.value?.pages[0]).toBe('Faculty Handbook');
  }, 10_000);

  it('should report a read whose deadline passes before its first page', async () => {
    const result = await createExtractor().extract(HANDBOOK, createBudget(AbortSignal.abort()));
    expect(result.error).toBe('deadline');
  });

  it('should kill a read past its memory cap without the server holding what it inflated (§3.4)', async () => {
    const bomb = createDecompressionBombPdf(1_024);
    const residentBefore = process.memoryUsage.rss();
    const result = await createExtractor().extract(bomb, createBudget());
    expect(result.error).toBe('memory-limit');
    expect(process.memoryUsage.rss() - residentBefore).toBeLessThan(TEST_MEMORY_CAP_BYTES);
  }, 10_000);

  it('should hold a read beyond its slots until one frees, and refuse one still waiting at its deadline', async () => {
    const extractor = createExtractor(1);
    const holder = new AbortController();
    const holding = extractor.extract(SLOW_HANDBOOK, createBudget(holder.signal));
    const waiting = extractor.extract(HANDBOOK, createBudget());
    const refused = await extractor.extract(HANDBOOK, createBudget(AbortSignal.timeout(500)));
    holder.abort();
    expect(refused.error).toBe('busy');
    expect((await waiting).value?.pages).toHaveLength(3);
    await holding;
  }, 10_000);

  it('should report bytes that do not parse as a PDF as malformed', async () => {
    const result = await createExtractor().extract(
      new TextEncoder().encode('<!doctype html><h1>Not Found</h1>'),
      createBudget()
    );
    expect(result.error).toBe('malformed');
  });
});
