import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { BrowserClient } from '../browser/browser.client.ts';
import { BrowserSession } from '../browser/browser.session.ts';
import { FetchClient } from '../fetch/fetch.client.ts';
import { pageToMarkdown } from '../markdown/markdown.utils.ts';
import { PdfTextExtractor } from '../pdf/pdf-text.extractor.ts';
import { MARKDOWN_CAP_CHARS } from '../web.constants.ts';
import { refuseUnbrowsableUrl } from '../web.policy.ts';
import { WebService } from '../web.service.ts';
import { ADDRESS_POLICY_TOKEN } from '../web.tokens.ts';

import type { FetchedDocument, FetchedPdf } from '../fetch/fetch.types.ts';
import type { AddressPolicy, PageRead, RenderedCapture, WebFailure } from '../web.types.ts';

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

/** the directory inside the site's chrome, as a CMS template serves it */
const TEMPLATED_DIRECTORY = `<!doctype html><html><head><title>Faculty</title></head><body>
  <header><a href="/">Northmoor University</a><nav><a href="/admissions">Admissions</a><a href="/research">Research</a></nav></header>
  <main><h1>Faculty</h1><p>Duval, P. — duval@northmoor.example</p></main>
  <footer><p>Northmoor University, 1 College Road — accessibility — privacy</p></footer>
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

/** a cap below the shipped one, so filling it takes two turns rather than four */
const MAX_BROWSER_SESSIONS = 2;

const FROM_THE_TOP: PageRead = { kind: 'window', startChar: 0, wholePage: false };

const rendered = (over: Partial<RenderedCapture>): RenderedCapture => ({
  formElements: [],
  html: '<h1>Faculty</h1>',
  openedUrls: [],
  status: 200,
  title: 'Faculty',
  url: 'https://northmoor.example/people/',
  ...over
});

const fetched = (over: Partial<FetchedDocument>): FetchedDocument => ({
  body: '<title>Faculty</title><h1>Faculty</h1>',
  kind: 'html',
  status: 200,
  url: 'https://northmoor.example/people/',
  ...over
});

const fetchedPdf = (over: Partial<FetchedPdf> = {}): FetchedPdf => ({
  bytes: new Uint8Array(Buffer.from('%PDF-1.4')),
  isTruncated: false,
  kind: 'pdf',
  status: 200,
  url: 'https://northmoor.example/documents/handbook.pdf',
  ...over
});

describe('WebService', () => {
  let browserClient: MockedInstance<BrowserClient>;
  let fetchClient: MockedInstance<FetchClient>;
  let loggingService: MockedInstance<LoggingService>;
  let pdfTextExtractor: MockedInstance<PdfTextExtractor>;
  let session: MockedInstance<BrowserSession>;
  let webService: WebService;

  beforeEach(async () => {
    policy.resolve.mockReset();
    policy.resolve.mockResolvedValue(Result.ok({ address: '203.0.113.7', family: 4 }));
    browserClient = MockFactory.createMock(BrowserClient);
    fetchClient = MockFactory.createMock(FetchClient);
    loggingService = MockFactory.createMock(LoggingService);
    pdfTextExtractor = MockFactory.createMock(PdfTextExtractor);
    session = MockFactory.createMock(BrowserSession);
    browserClient.createSession.mockResolvedValue(Result.ok(session as unknown as BrowserSession));
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebService,
        { provide: ADDRESS_POLICY_TOKEN, useValue: policy },
        { provide: BrowserClient, useValue: browserClient },
        {
          provide: ConfigService,
          useValue: createConfigServiceMock({ web: { maxBrowserSessions: MAX_BROWSER_SESSIONS } })
        },
        { provide: FetchClient, useValue: fetchClient },
        { provide: LoggingService, useValue: loggingService },
        { provide: PdfTextExtractor, useValue: pdfTextExtractor }
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

    it('should report busy once every live-session slot the deployment declares belongs to another turn', async () => {
      session.navigate.mockResolvedValue(Result.ok(rendered({})));
      for (let index = 0; index < MAX_BROWSER_SESSIONS; index++) {
        await webService.navigate(`turn-${index}`, 'https://northmoor.example/');
      }
      const result = await webService.navigate('turn-overflow', 'https://northmoor.example/');
      expect(result.error).toStrictEqual({ kind: 'busy', sessions: MAX_BROWSER_SESSIONS });
      expect(loggingService.warn).toHaveBeenCalledWith(expect.stringContaining('by turns turn-0, turn-1'));
    });
  });

  describe('fetch', () => {
    it('should convert a fetched directory by the same rules as a rendered one, without a session', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: FACULTY_DIRECTORY })));
      const result = await webService.fetch('https://northmoor.example/people/', FROM_THE_TOP);
      expect(result.value?.markdown).toContain(
        '| Duval, P. | 217 BSB | — | [duval@northmoor.example](mailto:duval@northmoor.example) |'
      );
      expect(result.value?.title).toBe('Full-Time Faculty — Department of Psychology — Northmoor University');
      expect(browserClient.createSession).not.toHaveBeenCalled();
    });

    it('should read on from an offset so a page past the cap can be finished (§3.8)', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: FACULTY_DIRECTORY })));
      const page = pageToMarkdown(FACULTY_DIRECTORY, 'https://northmoor.example/people/');
      const result = await webService.fetch('https://northmoor.example/people/', {
        kind: 'window',
        startChar: 10,
        wholePage: false
      });
      expect(result.value?.markdown).toBe(`${page.slice(10)}\n…showing characters 10–${page.length} of ${page.length}`);
      expect(result.value?.shown).toStrictEqual({ from: 10, to: page.length, total: page.length });
    });

    it('should answer a find with where each phrase occurs in the page, and how often (§3.4)', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: FACULTY_DIRECTORY })));
      const page = pageToMarkdown(FACULTY_DIRECTORY, 'https://northmoor.example/people/');
      const result = await webService.fetch('https://northmoor.example/people/', {
        kind: 'find',
        phrases: ['Duval', 'fax'],
        wholePage: false
      });
      expect(result.value?.matches).toBe(3);
      expect(result.value?.markdown).toContain(`"Duval" — 3 matches\nat ${page.indexOf('Duval')}: `);
      expect(result.value?.markdown).toContain('"fax" — no match');
      expect(result.value?.shown).toBeUndefined();
    });

    it('should read a page without its chrome, saying how much that left out and how to include it (§3.4)', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: TEMPLATED_DIRECTORY })));
      const whole = pageToMarkdown(TEMPLATED_DIRECTORY, 'https://northmoor.example/people/');
      const main = '# Faculty\n\nDuval, P. — duval@northmoor.example';
      const result = await webService.fetch('https://northmoor.example/people/', FROM_THE_TOP);
      expect(result.value?.markdown).toBe(
        `…${whole.length - main.length} characters outside the page's main content (navigation, header, footer) ` +
          'are left out, and offsets count without them; pass wholePage=true to include them\n\n' +
          `${main}\n…end of page, ${main.length} characters in all`
      );
    });

    it('should read the whole page when asked', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: TEMPLATED_DIRECTORY })));
      const result = await webService.fetch('https://northmoor.example/people/', { ...FROM_THE_TOP, wholePage: true });
      expect(result.value?.markdown).toMatch(/^\[Northmoor University\].*Admissions/su);
    });

    it('should refuse a page that needs client rendering, naming the tool that can', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: CLIENT_RENDERED_DIRECTORY })));
      const result = await webService.fetch('https://northmoor.example/people/', FROM_THE_TOP);
      expect(result.error).toStrictEqual({
        kind: 'no-static-content',
        status: 200,
        url: 'https://northmoor.example/people/'
      });
    });

    it('should report a 404 whose body reads as nothing as the status it is, not as a page needing JavaScript', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: '<html></html>', status: 404 })));
      const result = await webService.fetch('https://northmoor.example/gone', FROM_THE_TOP);
      expect(result.error).toStrictEqual({
        bodyChars: 13,
        kind: 'http-error',
        status: 404,
        url: 'https://northmoor.example/people/'
      });
    });

    it('should refuse a page the site refused to a read without a browser, and never render it instead (§3.4)', async () => {
      fetchClient.get.mockResolvedValue(
        Result.ok(
          fetched({ body: '<h1>403 Forbidden</h1><p>Request forbidden by administrative rules.</p>', status: 403 })
        )
      );
      const result = await webService.fetch('https://northmoor.example/people/', FROM_THE_TOP);
      expect(result.error).toStrictEqual({ kind: 'blocked', status: 403, url: 'https://northmoor.example/people/' });
      expect(browserClient.createSession).not.toHaveBeenCalled();
    });

    it('should hand back an HTTP error as a page', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetched({ body: '<h1>Not Found</h1>', status: 404 })));
      const result = await webService.fetch('https://northmoor.example/gone', FROM_THE_TOP);
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
      const result = await webService.fetch('https://northmoor.example/api/people.json', FROM_THE_TOP);
      expect(result.value).toMatchObject({
        markdown: '{"a":1}\n…end of page, 7 characters in all',
        title: '/api/people.json'
      });
    });

    it("should read a PDF's text layer, each page under its marker, titled by its path (§3.4)", async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetchedPdf()));
      pdfTextExtractor.extract.mockResolvedValue(Result.ok({ pageCount: 2, pages: ['Faculty Handbook', 'Duval, P.'] }));
      const result = await webService.fetch('https://northmoor.example/documents/handbook.pdf', FROM_THE_TOP);
      expect(result.value?.markdown).toContain('[page 1 of 2]\nFaculty Handbook\n\n[page 2 of 2]\nDuval, P.');
      expect(result.value?.title).toBe('/documents/handbook.pdf');
    });

    it('should refuse a PDF with no text layer as the scan it most likely is (§3.4)', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetchedPdf()));
      pdfTextExtractor.extract.mockResolvedValue(Result.ok({ pageCount: 3, pages: ['', ' ', '\n'] }));
      const result = await webService.fetch('https://northmoor.example/documents/handbook.pdf', FROM_THE_TOP);
      expect(result.error).toStrictEqual({
        kind: 'no-text',
        pageCount: 3,
        url: 'https://northmoor.example/documents/handbook.pdf'
      });
    });

    it('should refuse a PDF cut at the byte cap without parsing it', async () => {
      fetchClient.get.mockResolvedValue(Result.ok(fetchedPdf({ isTruncated: true })));
      const result = await webService.fetch('https://northmoor.example/documents/handbook.pdf', FROM_THE_TOP);
      expect(result.error).toMatchObject({ kind: 'unreadable-pdf', reason: 'too-large' });
      expect(pdfTextExtractor.extract).not.toHaveBeenCalled();
    });

    it('should surface a transport failure untouched', async () => {
      fetchClient.get.mockResolvedValue(Result.err({ kind: 'url-refused', reason: 'not-web-scheme', url: 'ftp://x' }));
      const result = await webService.fetch('ftp://x', FROM_THE_TOP);
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
    // arrives afterwards would otherwise hold one of the live-session slots until restart
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
