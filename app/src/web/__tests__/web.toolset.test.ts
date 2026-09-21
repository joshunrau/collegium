import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';

import { SearchService } from '../search/search.service.ts';
import { WebService } from '../web.service.ts';
import { WEB_TOOLSET } from '../web.toolset.ts';

import type { WebPage, WebSnapshot } from '../web.types.ts';

const { click, fetch, fill, hover, navigate, search } = WEB_TOOLSET.tools;

const BRAVE = { apiKey: 'test-key', kind: 'brave' } as const;

const SNAPSHOT: WebSnapshot = {
  formElements: [{ isHidden: false, kind: 'input', label: 'Search', ref: 'e1', type: 'text', value: '' }],
  markdown: '# Example Domain',
  openedUrls: [],
  status: 200,
  title: 'Example',
  url: 'https://example.org/'
};

const PAGE: WebPage = { markdown: '# Example Domain', status: 200, title: 'Example', url: 'https://example.org/' };

function buildContext() {
  const search = MockFactory.createMock(SearchService);
  const web = MockFactory.createMock(WebService);
  const context = { search, settings: { search: { provider: BRAVE } }, turn: buildToolTurnScope(), web };
  return { context, search, web };
}

describe('WEB_TOOLSET', () => {
  it('navigates and returns the page snapshot with its form controls', async () => {
    const { context, web } = buildContext();
    web.navigate.mockResolvedValue(Result.ok(SNAPSHOT));
    const result = await executeTool(navigate, { url: 'https://example.org/' }, context);
    expect(web.navigate).toHaveBeenCalledWith('turn-1', 'https://example.org/');
    expect(result.unwrap().text).toContain('Example — https://example.org/ (HTTP 200)');
    expect(result.unwrap().text).toContain('⟨e1⟩ input[type=text] "Search"');
  });

  it('fetches a page without a session and renders it with its header line', async () => {
    const { context, web } = buildContext();
    web.fetch.mockResolvedValue(Result.ok(PAGE));
    const result = await executeTool(fetch, { startChar: 0, url: 'https://example.org/' }, context);
    expect(web.fetch).toHaveBeenCalledWith('https://example.org/', 0, undefined);
    const text = 'Example — https://example.org/ (HTTP 200)\n\n# Example Domain';
    expect(result.unwrap()).toStrictEqual({
      replaySubject: `page https://example.org/, ${text.length} characters`,
      text
    });
  });

  it('reads on from an offset, and names the part of the page the result holds (§3.8)', async () => {
    const { context, web } = buildContext();
    web.fetch.mockResolvedValue(Result.ok({ ...PAGE, shown: { from: 1000, to: 2000, total: 5000 } }));
    const result = await executeTool(fetch, { startChar: 1000, url: 'https://example.org/' }, context);
    expect(web.fetch).toHaveBeenCalledWith('https://example.org/', 1000, undefined);
    expect(result.unwrap().replaySubject).toMatch(
      /^page https:\/\/example\.org\/ \(characters 1000–2000 of 5000\), \d+ characters$/u
    );
  });

  it('marks a click with the page it landed on, and a fetch with a status that is not success (§8.1)', async () => {
    const { context, web } = buildContext();
    web.click.mockResolvedValue(Result.ok(SNAPSHOT));
    web.fetch.mockResolvedValue(Result.ok({ ...PAGE, status: 404 }));
    const clicked = await executeTool(click, { ref: 'e1' }, context);
    const fetched = await executeTool(fetch, { startChar: 0, url: 'https://example.org/' }, context);
    expect(clicked.unwrap().traceOutcome).toBe('→ https://example.org/');
    expect(fetched.unwrap().traceOutcome).toBe('HTTP 404');
  });

  it('returns a page that needs client rendering as text pointing at navigate', async () => {
    const { context, web } = buildContext();
    web.fetch.mockResolvedValue(Result.err({ kind: 'no-static-content', status: 200, url: 'https://example.org/' }));
    const result = await executeTool(fetch, { url: 'https://example.org/' }, context);
    expect(result.unwrap().text).toContain('open it with web::navigate instead');
  });

  it('returns a stale ref as page text the model can recover from', async () => {
    const { context, web } = buildContext();
    web.click.mockResolvedValue(Result.err({ kind: 'stale-ref', ref: 'e7' }));
    const result = await executeTool(click, { ref: 'e7' }, context);
    expect(result.unwrap().text).toContain('⟨e7⟩ is not on the current page');
  });

  it('treats an unreachable browser as infrastructure, not model error', async () => {
    const { context, web } = buildContext();
    web.fill.mockResolvedValue(Result.err({ kind: 'unreachable', message: 'browser is down' }));
    const result = await executeTool(fill, { ref: 'e1', text: 'hello' }, context);
    expect(result.error).toStrictEqual({ kind: 'exception', message: 'browser is down' });
  });

  it('shows fill text in the trace line and never gates', () => {
    const detail = fill.traceDetail?.({ pressEnter: true, ref: 'e1', text: 'duval' });
    expect(detail).toBe('⟨e1⟩ with "duval" then press "Enter"');
    for (const tool of [click, fill, hover, navigate]) {
      expect('approval' in tool).toBe(false);
      expect(tool.retryable).toBeUndefined();
    }
  });

  it('leaves fetch ungated and retryable, since a scriptless GET commits nothing', () => {
    expect('approval' in fetch).toBe(false);
    expect(fetch.retryable).toBe(true);
    expect(fetch.traceDetail?.({ startChar: 0, url: 'https://example.org/' })).toBe('https://example.org/');
  });

  it('should name the offset in the trace so two windows do not collapse (§8.1)', () => {
    expect(fetch.traceDetail?.({ maxChars: 2000, startChar: -20_000, url: 'https://example.org/' })).toBe(
      'https://example.org/ from -20000 for 2000'
    );
  });

  it('reads a bounded window of a page, passing the width through to the fetch (§3.8)', async () => {
    const { context, web } = buildContext();
    web.fetch.mockResolvedValue(Result.ok({ ...PAGE, shown: { from: 0, to: 2000, total: 5000 } }));
    await executeTool(fetch, { maxChars: 2000, startChar: 0, url: 'https://example.org/' }, context);
    expect(web.fetch).toHaveBeenCalledWith('https://example.org/', 0, 2000);
  });

  it('hovers a ref and returns the snapshot that reveals what the hover exposed', async () => {
    const { context, web } = buildContext();
    web.hover.mockResolvedValue(Result.ok(SNAPSHOT));
    const result = await executeTool(hover, { ref: 'e4' }, context);
    expect(web.hover).toHaveBeenCalledWith('turn-1', 'e4');
    expect(result.unwrap().text).toContain('Example — https://example.org/ (HTTP 200)');
  });

  it('searches with the configured provider and renders ranked summaries', async () => {
    const { context, search: searchService } = buildContext();
    searchService.search.mockResolvedValue(
      Result.ok([{ age: '2 days ago', description: 'An example.', title: 'Example', url: 'https://example.org/' }])
    );
    const result = await executeTool(search, { count: 5, query: 'example' }, context);
    expect(searchService.search).toHaveBeenCalledWith(BRAVE, { count: 5, query: 'example' });
    expect(result.unwrap().text).toBe(
      'Results for "example" — each is the provider\'s own excerpt, not the page:\n\n1. Example — https://example.org/\n   2 days ago · An example.'
    );
  });

  it('returns throttling as text the model can plan around', async () => {
    const { context, search: searchService } = buildContext();
    searchService.search.mockResolvedValue(Result.err({ kind: 'rate-limited' }));
    const result = await executeTool(search, { count: 5, query: 'example' }, context);
    expect(result.unwrap().text).toContain('rate-limiting');
  });

  it('is available only where web settings configure a search provider', () => {
    expect(search.isAvailableWith?.({})).toBe(false);
    expect(search.isAvailableWith?.({ search: { provider: BRAVE } })).toBe(true);
  });

  it('leaves search ungated and retryable, tracing the query', () => {
    expect('approval' in search).toBe(false);
    expect(search.retryable).toBe(true);
    expect(search.traceDetail?.({ count: 10, query: 'example' })).toBe('"example"');
  });
});
