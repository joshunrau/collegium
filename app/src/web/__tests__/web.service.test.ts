import * as fs from 'node:fs';
import * as path from 'node:path';

import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { BrowserClient } from '../browser/browser.client.ts';
import { BrowserSession } from '../browser/browser.session.ts';
import { FetchClient } from '../fetch/fetch.client.ts';
import { MARKDOWN_CAP_CHARS, MAX_LIVE_SESSIONS } from '../web.constants.ts';
import { WebService } from '../web.service.ts';

import type { FetchedResource } from '../fetch/fetch.types.ts';
import type { RenderedCapture, WebFailure } from '../web.types.ts';

const fixture = (name: string): string => {
  return fs.readFileSync(path.resolve(import.meta.dirname, 'fixtures', `${name}.html`), 'utf-8');
};

const rendered = (over: Partial<RenderedCapture>): RenderedCapture => ({
  formElements: [],
  html: '<h1>Faculty</h1>',
  status: 200,
  title: 'Faculty',
  url: 'https://northmoor.example/people/',
  ...over
});

const fetched = (over: Partial<FetchedResource>): FetchedResource => ({
  body: '<title>Faculty</title><h1>Faculty</h1>',
  kind: 'html',
  status: 200,
  url: 'https://northmoor.example/people/',
  ...over
});

describe('WebService', () => {
  let browserClient: MockedInstance<BrowserClient>;
  let fetchClient: MockedInstance<FetchClient>;
  let session: MockedInstance<BrowserSession>;
  let webService: WebService;

  beforeEach(async () => {
    browserClient = MockFactory.createMock(BrowserClient);
    fetchClient = MockFactory.createMock(FetchClient);
    session = MockFactory.createMock(BrowserSession);
    browserClient.createSession.mockResolvedValue(Result.ok(session as unknown as BrowserSession));
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebService,
        { provide: BrowserClient, useValue: browserClient },
        { provide: FetchClient, useValue: fetchClient }
      ]
    }).compile();
    webService = moduleRef.get(WebService);
  });

  describe('navigate', () => {
    it('should return a faculty directory as markdown, with each name beside its own email', async () => {
      session.navigate.mockResolvedValue(Result.ok(rendered({ html: fixture('static-directory') })));
      const result = await webService.navigate('turn-1', 'https://northmoor.example/people/');
      expect(result.value?.markdown).toContain(
        '| Duval, P. | 217 BSB | — | [duval@northmoor.example](mailto:duval@northmoor.example) |'
      );
    });

    it('should hand back an HTTP error as a page, since a 404 is something the model reasons about', async () => {
      session.navigate.mockResolvedValue(
        Result.ok(rendered({ html: '<h1>Not Found</h1>', status: 404, title: 'Not Found' }))
      );
      const result = await webService.navigate('turn-1', 'https://northmoor.example/gone');
      expect(result.value?.status).toBe(404);
      expect(result.value?.markdown).toBe('# Not Found');
    });

    it('should reuse the turn session, so mid-session navigation keeps its page state', async () => {
      session.navigate.mockResolvedValue(Result.ok(rendered({})));
      await webService.navigate('turn-1', 'https://northmoor.example/');
      await webService.navigate('turn-1', 'https://northmoor.example/people/');
      expect(browserClient.createSession).toHaveBeenCalledTimes(1);
    });

    it('should refuse a page that rendered nothing, which reads as "no results" otherwise', async () => {
      session.navigate.mockResolvedValue(Result.ok(rendered({ html: fixture('spa-marketing-site') })));
      const result = await webService.navigate('turn-1', 'https://northmoor.example/');
      expect(result.error).toStrictEqual({ kind: 'empty-render', url: 'https://northmoor.example/people/' });
    });

    it('should cut a page past the guard rather than shortening it silently', async () => {
      session.navigate.mockResolvedValue(Result.ok(rendered({ html: `<p>${'x'.repeat(MARKDOWN_CAP_CHARS + 1)}</p>` })));
      const result = await webService.navigate('turn-1', 'https://northmoor.example/huge');
      expect(result.value?.markdown).toContain(`…page truncated at ${MARKDOWN_CAP_CHARS} characters`);
    });

    it('should surface a navigation failure untouched, since there is no page to report', async () => {
      session.navigate.mockResolvedValue(Result.err({ kind: 'navigation', message: 'net::ERR_NAME_NOT_RESOLVED' }));
      const result = await webService.navigate('turn-1', 'https://nope.northmoor.example/');
      expect(result.error).toStrictEqual({ kind: 'navigation', message: 'net::ERR_NAME_NOT_RESOLVED' });
    });

    it('should report busy once every live-session slot belongs to another turn', async () => {
      session.navigate.mockResolvedValue(Result.ok(rendered({})));
      for (let index = 0; index < MAX_LIVE_SESSIONS; index++) {
        await webService.navigate(`turn-${index}`, 'https://northmoor.example/');
      }
      const result = await webService.navigate('turn-overflow', 'https://northmoor.example/');
      expect(result.error).toStrictEqual({ kind: 'busy' });
    });
  });

  describe('fetch', () => {
    it('should convert a fetched directory by the same rules as a rendered one, without a session', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: fixture('static-directory') })));
      const result = await webService.fetch('https://northmoor.example/people/');
      expect(result.value?.markdown).toContain(
        '| Duval, P. | 217 BSB | — | [duval@northmoor.example](mailto:duval@northmoor.example) |'
      );
      expect(result.value?.title).toBe('Full-Time Faculty — Department of Psychology — Northmoor University');
      expect(browserClient.createSession).not.toHaveBeenCalled();
    });

    it('should refuse a page that needs client rendering, naming the tool that can', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: fixture('client-rendered-directory') })));
      const result = await webService.fetch('https://northmoor.example/people/');
      expect(result.error).toStrictEqual({ kind: 'no-static-content', url: 'https://northmoor.example/people/' });
    });

    it('should hand back an HTTP error as a page', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: '<h1>Not Found</h1>', status: 404 })));
      const result = await webService.fetch('https://northmoor.example/gone');
      expect(result.value).toMatchObject({ markdown: '# Not Found', status: 404, title: '' });
    });

    it('should pass a text resource through untouched, titled by its path', async () => {
      fetchClient.get.mockResolvedValue(
        Result.ok(fetched({ body: '{"a":1}', kind: 'text', url: 'https://northmoor.example/api/people.json' }))
      );
      const result = await webService.fetch('https://northmoor.example/api/people.json');
      expect(result.value).toMatchObject({ markdown: '{"a":1}', title: '/api/people.json' });
    });

    it('should surface a transport failure untouched', async () => {
      fetchClient.get.mockResolvedValue(Result.err({ kind: 'url-refused', reason: 'not-web-scheme', url: 'ftp://x' }));
      const result = await webService.fetch('ftp://x');
      expect(result.error).toStrictEqual({ kind: 'url-refused', reason: 'not-web-scheme', url: 'ftp://x' });
    });
  });

  describe('click and fill', () => {
    it('should refuse to act before any navigate, since there is no page', async () => {
      const result = await webService.click('turn-1', 'e1');
      expect(result.error).toStrictEqual({ kind: 'no-session' });
      expect(browserClient.createSession).not.toHaveBeenCalled();
    });

    it('should drive the turn session with the ref and text the model chose', async () => {
      session.navigate.mockResolvedValue(Result.ok(rendered({})));
      session.fill.mockResolvedValue(Result.ok(rendered({ html: '<h1>Filtered</h1>' })));
      await webService.navigate('turn-1', 'https://northmoor.example/');
      const result = await webService.fill('turn-1', { pressEnter: true, ref: 'e4', text: 'duval' });
      expect(session.fill).toHaveBeenCalledWith('e4', 'duval', true);
      expect(result.value?.markdown).toBe('# Filtered');
    });
  });

  describe('endTurn', () => {
    it('should dispose the session and leave the turn with no page', async () => {
      session.navigate.mockResolvedValue(Result.ok(rendered({})));
      await webService.navigate('turn-1', 'https://northmoor.example/');
      await webService.endTurn('turn-1');
      expect(session.dispose).toHaveBeenCalledTimes(1);
      const result = await webService.click('turn-1', 'e1');
      expect(result.error).toStrictEqual({ kind: 'no-session' });
    });

    // a tool timeout or /kill ends the turn while the launch is still in flight; the session that
    // arrives afterwards would otherwise hold one of MAX_LIVE_SESSIONS until restart
    it('should dispose a session whose launch outlived the turn that asked for it', async () => {
      let settle!: (created: Result<BrowserSession, WebFailure.Unreachable>) => void;
      browserClient.createSession.mockReturnValue(new Promise((resolve) => (settle = resolve)));
      session.navigate.mockResolvedValue(Result.ok(rendered({})));
      const navigating = webService.navigate('turn-1', 'https://northmoor.example/');
      const ending = webService.endTurn('turn-1');
      settle(Result.ok(session as unknown as BrowserSession));
      await Promise.all([navigating, ending]);
      expect(session.dispose).toHaveBeenCalledTimes(1);
    });

    it('should free the slot when a launch fails, so the turn may browse again', async () => {
      browserClient.createSession.mockResolvedValueOnce(Result.err({ kind: 'unreachable', message: 'no browser' }));
      session.navigate.mockResolvedValue(Result.ok(rendered({})));
      expect((await webService.navigate('turn-1', 'https://northmoor.example/')).error).toMatchObject({
        kind: 'unreachable'
      });
      expect((await webService.navigate('turn-1', 'https://northmoor.example/')).success).toBe(true);
    });
  });
});
