import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { BrowserClient } from '../browser/browser.client.ts';
import { BrowserSession } from '../browser/browser.session.ts';
import { FetchClient } from '../fetch/fetch.client.ts';
import { MARKDOWN_CAP_CHARS, MAX_LIVE_SESSIONS } from '../web.constants.ts';
import { refuseUnbrowsableUrl } from '../web.policy.ts';
import { WebService } from '../web.service.ts';
import { ADDRESS_POLICY_TOKEN } from '../web.tokens.ts';
import { toMarkdown } from '../web.utils.ts';

import type { FetchedResource } from '../fetch/fetch.types.ts';
import type { AddressPolicy, RenderedCapture, WebFailure } from '../web.types.ts';

/** the strict scheme rule, with the resolved half scripted per test */
const policy = {
  refuse: vi.fn(refuseUnbrowsableUrl),
  resolve: vi.fn<AddressPolicy['resolve']>(),
  vet: vi.fn<AddressPolicy['vet']>()
};

const FACULTY_DIRECTORY = `<!doctype html><html><head>
  <title>Full-Time Faculty — Department of Psychology — Northmoor University</title>
</head><body>
  <table>
    <thead><tr><th>Name</th><th>Office</th><th>Extension</th><th>Email</th></tr></thead>
    <tbody>
      <tr><td>Duval, P.</td><td>217 BSB</td><td>—</td><td><a href="mailto:duval@northmoor.example">duval@northmoor.example</a></td></tr>
    </tbody>
  </table>
</body></html>`;

/** nothing here survives conversion: the shell is the whole document until a script fills it */
const SPA_MARKETING_SITE = `<!doctype html><html><head>
  <title>Northmoor Institute — Advancing What Comes Next</title>
</head><body>
  <div id="app"></div>
  <noscript>Northmoor Institute requires JavaScript.</noscript>
  <script src="/institute.js"></script>
</body></html>`;

/** as above: a directory whose rows exist only once the browser has run its script */
const CLIENT_RENDERED_DIRECTORY = `<!doctype html><html><head>
  <title>Full-Time Faculty — Department of Psychology — Northmoor University</title>
</head><body>
  <div id="app"></div>
  <noscript>This directory requires JavaScript.</noscript>
  <script src="/directory.js"></script>
</body></html>`;

const rendered = (over: Partial<RenderedCapture>): RenderedCapture => ({
  formElements: [],
  html: '<h1>Faculty</h1>',
  openedUrls: [],
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
    policy.resolve.mockReset();
    policy.resolve.mockResolvedValue(Result.ok({ address: '203.0.113.7', family: 4 }));
    browserClient = MockFactory.createMock(BrowserClient);
    fetchClient = MockFactory.createMock(FetchClient);
    session = MockFactory.createMock(BrowserSession);
    browserClient.createSession.mockResolvedValue(Result.ok(session as unknown as BrowserSession));
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebService,
        { provide: ADDRESS_POLICY_TOKEN, useValue: policy },
        { provide: BrowserClient, useValue: browserClient },
        { provide: FetchClient, useValue: fetchClient }
      ]
    }).compile();
    webService = moduleRef.get(WebService);
  });

  describe('navigate', () => {
    it('should return a faculty directory as markdown, with each name beside its own email', async () => {
      session.navigate.mockResolvedValue(Result.ok(rendered({ html: FACULTY_DIRECTORY })));
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
      session.navigate.mockResolvedValue(Result.ok(rendered({ html: SPA_MARKETING_SITE })));
      const result = await webService.navigate('turn-1', 'https://northmoor.example/');
      expect(result.error).toStrictEqual({
        kind: 'empty-render',
        status: 200,
        url: 'https://northmoor.example/people/'
      });
    });

    it('should cut a page past the guard rather than shortening it silently', async () => {
      session.navigate.mockResolvedValue(Result.ok(rendered({ html: `<p>${'x'.repeat(MARKDOWN_CAP_CHARS + 1)}</p>` })));
      const result = await webService.navigate('turn-1', 'https://northmoor.example/huge');
      expect(result.value?.markdown).toContain(
        `…page truncated at ${MARKDOWN_CAP_CHARS} of ${MARKDOWN_CAP_CHARS + 1} characters`
      );
      expect(result.value?.shown).toStrictEqual({ from: 0, to: MARKDOWN_CAP_CHARS, total: MARKDOWN_CAP_CHARS + 1 });
    });

    it('should refuse an address that resolves privately as a typed refusal, never a failed page (§3.4)', async () => {
      const refused: WebFailure.UrlRefused = {
        kind: 'url-refused',
        reason: 'not-public-host',
        url: 'https://intranet.northmoor.example/'
      };
      policy.resolve.mockResolvedValueOnce(Result.err(refused));
      const result = await webService.navigate('turn-1', 'https://intranet.northmoor.example/');
      expect(result.error).toStrictEqual(refused);
      expect(session.navigate).not.toHaveBeenCalled();
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
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: FACULTY_DIRECTORY })));
      const result = await webService.fetch('https://northmoor.example/people/');
      expect(result.value?.markdown).toContain(
        '| Duval, P. | 217 BSB | — | [duval@northmoor.example](mailto:duval@northmoor.example) |'
      );
      expect(result.value?.title).toBe('Full-Time Faculty — Department of Psychology — Northmoor University');
      expect(browserClient.createSession).not.toHaveBeenCalled();
    });

    it('should read on from an offset so a page past the cap can be finished (§3.8)', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: FACULTY_DIRECTORY })));
      const page = toMarkdown(FACULTY_DIRECTORY, 'https://northmoor.example/people/');
      const result = await webService.fetch('https://northmoor.example/people/', 10);
      expect(result.value?.markdown).toBe(`${page.slice(10)}\n…showing characters 10–${page.length} of ${page.length}`);
      expect(result.value?.shown).toStrictEqual({ from: 10, to: page.length, total: page.length });
    });

    it('should refuse a page that needs client rendering, naming the tool that can', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: CLIENT_RENDERED_DIRECTORY })));
      const result = await webService.fetch('https://northmoor.example/people/');
      expect(result.error).toStrictEqual({
        kind: 'no-static-content',
        status: 200,
        url: 'https://northmoor.example/people/'
      });
    });

    it('should report a 404 whose body reads as nothing as the status it is, not as a page needing JavaScript', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: '<html></html>', status: 404 })));
      const result = await webService.fetch('https://northmoor.example/gone');
      expect(result.error).toStrictEqual({
        bodyChars: 13,
        kind: 'http-error',
        status: 404,
        url: 'https://northmoor.example/people/'
      });
    });

    it('should hand back an HTTP error as a page', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: '<h1>Not Found</h1>', status: 404 })));
      const result = await webService.fetch('https://northmoor.example/gone');
      expect(result.value).toMatchObject({
        markdown: '# Not Found\n…end of page, 11 characters in all',
        status: 404,
        title: ''
      });
    });

    it('should pass a text resource through untouched, titled by its path', async () => {
      fetchClient.get.mockResolvedValue(
        Result.ok(fetched({ body: '{"a":1}', kind: 'text', url: 'https://northmoor.example/api/people.json' }))
      );
      const result = await webService.fetch('https://northmoor.example/api/people.json');
      expect(result.value).toMatchObject({
        markdown: '{"a":1}\n…end of page, 7 characters in all',
        title: '/api/people.json'
      });
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
