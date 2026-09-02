import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';

import { WebService } from '../web.service.ts';
import { WEB_TOOLSET } from '../web.toolset.ts';

import type { WebPage, WebSnapshot } from '../web.types.ts';

const { click, fetch, fill, navigate } = WEB_TOOLSET.tools;

const SNAPSHOT: WebSnapshot = {
  formElements: [{ isFilled: false, kind: 'input', label: 'Search', ref: 'e1', type: 'text' }],
  markdown: '# Example Domain',
  status: 200,
  title: 'Example',
  url: 'https://example.org/'
};

const PAGE: WebPage = { markdown: '# Example Domain', status: 200, title: 'Example', url: 'https://example.org/' };

function buildContext() {
  const web = MockFactory.createMock(WebService);
  const context = { turn: buildToolTurnScope(), web };
  return { context, web };
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
    const result = await executeTool(fetch, { url: 'https://example.org/' }, context);
    expect(web.fetch).toHaveBeenCalledWith('https://example.org/');
    expect(result.unwrap().text).toBe('Example — https://example.org/ (HTTP 200)\n\n# Example Domain');
  });

  it('returns a page that needs client rendering as text pointing at navigate', async () => {
    const { context, web } = buildContext();
    web.fetch.mockResolvedValue(Result.err({ kind: 'no-static-content', url: 'https://example.org/' }));
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

  it('masks fill text in the trace line and never gates (§3.4)', () => {
    const detail = fill.traceDetail?.({ pressEnter: true, ref: 'e1', text: 'hunter2' });
    expect(detail).toBe('⟨e1⟩ with 7 character(s) then press "Enter"');
    expect(detail).not.toContain('hunter2');
    for (const tool of [click, fill, navigate]) {
      expect('approval' in tool).toBe(false);
      expect(tool.retryable).toBeUndefined();
    }
  });

  it('leaves fetch ungated and retryable, since a scriptless GET commits nothing', () => {
    expect('approval' in fetch).toBe(false);
    expect(fetch.retryable).toBe(true);
    expect(fetch.traceDetail?.({ url: 'https://example.org/' })).toBe('https://example.org/');
  });
});
