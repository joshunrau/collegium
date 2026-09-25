import { describe, expect, it } from 'vitest';

import { FORM_CONTROLS_MAX_CHARS, SELECT_OPTIONS_SHOWN, SNAPSHOT_VIEW_CHARS } from '../web.constants.ts';
import { describeWebFailureOutcome, renderWebFailure, renderWebPage, renderWebSnapshot } from '../web.renderer.ts';

import type { WebFailure, WebSnapshot } from '../web.types.ts';

describe('renderWebFailure', () => {
  it('should tell the model which tool can read a page that needs client rendering, and the status it got', () => {
    expect(renderWebFailure({ kind: 'no-static-content', status: 200, url: 'https://northmoor.example/' })).toBe(
      'the page at https://northmoor.example/ answered HTTP 200 and has no readable content without JavaScript — open it with web::navigate instead'
    );
  });

  it('should not name web::navigate for a page the server said is not there, nor take it for an absence (§3.4)', () => {
    const line = renderWebFailure({
      bodyChars: 0,
      kind: 'http-error',
      status: 404,
      url: 'https://northmoor.example/gone'
    });
    expect(line).toBe(
      'https://northmoor.example/gone answered HTTP 404 with 0 characters of body and nothing readable in it; ' +
        'there is no page at this address, and a browser will not find one. If you built this URL rather than read ' +
        "it off a page, this says nothing about the page you were after; use the site's index or search to find it."
    );
    expect(line).not.toContain('web::navigate');
  });

  it('should say only what an empty error page shows when its status is not 404 or 410', () => {
    expect(
      renderWebFailure({ bodyChars: 0, kind: 'http-error', status: 500, url: 'https://northmoor.example/people/' })
    ).toBe('https://northmoor.example/people/ answered HTTP 500 with 0 characters of body and nothing readable in it');
  });

  it('should name web::navigate for a page the site refused to a read without a browser (§3.4)', () => {
    expect(renderWebFailure({ kind: 'blocked', status: 403, url: 'https://northmoor.example/people/' })).toContain(
      'web::navigate may get through'
    );
  });

  it("should lay a certificate's failure on the site only where the error establishes it (§3.4)", () => {
    expect(renderWebFailure({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', kind: 'tls', reason: 'incomplete-chain' })).toBe(
      'the page could not be loaded securely: the site sends its certificate without the intermediates that link ' +
        "it to a trusted authority — a fault in the site's TLS configuration, which retrying will not fix " +
        '(UNABLE_TO_VERIFY_LEAF_SIGNATURE)'
    );
    expect(renderWebFailure({ code: 'SEC_ERROR_UNKNOWN_ISSUER', kind: 'tls', reason: 'untrusted-issuer' })).toContain(
      "the site's configuration or this deployment's trust store may be at fault"
    );
  });

  it('should carry the status on a page that rendered nothing', () => {
    expect(renderWebFailure({ kind: 'empty-render', status: 500, url: 'https://northmoor.example/gone' })).toBe(
      'the page at https://northmoor.example/gone answered HTTP 500 and rendered no readable content'
    );
  });

  it('should name the content type nothing reads, and what can be read', () => {
    expect(
      renderWebFailure({
        contentType: 'image/png',
        kind: 'unsupported-content',
        url: 'https://northmoor.example/crest.png'
      })
    ).toBe(
      'https://northmoor.example/crest.png is image/png, which no web tool reads: web::fetch reads web pages, PDFs and text'
    );
  });

  it('should name web::fetch as the reader of a PDF the browser will not open (§3.4)', () => {
    expect(
      renderWebFailure({ contentType: 'application/pdf', kind: 'not-html', url: 'https://northmoor.example/cv.pdf' })
    ).toContain('read it with web::fetch');
  });

  it('should say a PDF without a text layer is most likely scanned (§3.4)', () => {
    expect(renderWebFailure({ kind: 'no-text', pageCount: 40, url: 'https://northmoor.example/roster.pdf' })).toBe(
      'the PDF at https://northmoor.example/roster.pdf has no text layer on any of its 40 pages: it is ' +
        'most likely scanned, and nothing here reads text from an image'
    );
  });

  it('should say a PDF refused for want of a free reader may be read if asked again (§3.4)', () => {
    const failure: WebFailure = { kind: 'unreadable-pdf', reason: 'busy', url: 'https://northmoor.example/roster.pdf' };
    expect(renderWebFailure(failure)).toContain('Asking again once they are done may read it');
    expect(describeWebFailureOutcome(failure)).toBe('⚠️ PDF reader busy');
  });

  it('should name hover as the way out of a ref CSS hides', () => {
    expect(renderWebFailure({ kind: 'not-visible', ref: 'e12' })).toContain('web::hover');
  });

  it("should report a failed action on a present element as the element's, naming web::select (§3.4)", () => {
    const line = renderWebFailure({
      kind: 'action-failed',
      message: 'Element is not an <input>, <textarea> or [contenteditable] element',
      ref: 'e359'
    });
    expect(line).toMatch(/^⟨e359⟩ is on the page, but the action on it failed: Element is not an <input>/u);
    expect(line).toContain('web::select');
    expect(line).not.toContain('could not be loaded');
  });

  it('should say a busy browser frees only when a holding turn ends, and that fetch still works (§3.4)', () => {
    expect(renderWebFailure({ kind: 'busy', sessions: 4 })).toBe(
      'all 4 browser sessions this deployment allows are held by other turns, and one frees only when the turn ' +
        'holding it ends. web::fetch needs no session and still works'
    );
  });
});

describe('describeWebFailureOutcome', () => {
  it('should mark a failed fetch with the status it got (§8.1)', () => {
    expect(
      describeWebFailureOutcome({
        bodyChars: 0,
        kind: 'http-error',
        status: 404,
        url: 'https://northmoor.example/gone'
      })
    ).toBe('⚠️ HTTP 404');
  });

  it('should mark a recoverable failure that has no status of its own (§8.1)', () => {
    expect(describeWebFailureOutcome({ kind: 'no-session' })).toBe('⚠️ no page open');
    expect(
      describeWebFailureOutcome({ kind: 'url-refused', reason: 'not-public-host', url: 'https://10.0.0.1/' })
    ).toBe('⚠️ refused');
  });
});

describe('renderWebPage', () => {
  it('should say a page is the answer to a retry after a rate limit (§3.4)', () => {
    const page = {
      markdown: '# Faculty',
      retry: { status: 429, waitedMs: 1_500 },
      status: 200,
      title: 'Faculty',
      url: 'https://northmoor.example/'
    };
    expect(renderWebPage(page)).toMatch(
      /^Faculty — https:\/\/northmoor\.example\/ \(HTTP 200; retried once, 1\.5 s after an HTTP 429\)\n/u
    );
  });

  it('should caution that a 404 on an address the model built says nothing about the page (§3.4)', () => {
    const page = {
      markdown: '# Not Found',
      status: 404,
      title: 'Not Found',
      url: 'https://northmoor.example/dr-duval'
    };
    expect(renderWebPage(page)).toBe(
      'Not Found — https://northmoor.example/dr-duval (HTTP 404)\nIf you built this URL rather than read it off a ' +
        "page, this says nothing about the page you were after; use the site's index or search to find it.\n\n# Not Found"
    );
  });
});

describe('renderWebSnapshot', () => {
  const SNAPSHOT: WebSnapshot = {
    formElements: [{ isHidden: false, kind: 'input', label: 'Search', ref: 'e1', type: 'text', value: '' }],
    markdown: '# Faculty',
    openedUrls: [],
    status: 200,
    title: 'Faculty',
    url: 'https://northmoor.example/'
  };

  it('should put the form controls before the page, and view the page to a fixed width past them (§3.4, §3.8)', () => {
    const markdown = `# Faculty\n\n${'Row. '.repeat((3 * SNAPSHOT_VIEW_CHARS) / 5)}`;
    const { text, viewChars } = renderWebSnapshot({ ...SNAPSHOT, markdown });
    expect(text.indexOf('⟨e1⟩')).toBeLessThan(text.indexOf('# Faculty'));
    expect(viewChars).toBe(text.indexOf('# Faculty') + SNAPSHOT_VIEW_CHARS);
  });

  it('should leave a snapshot shorter than its view whole', () => {
    const markdown = 'x'.repeat(43_000);
    const { text, viewChars } = renderWebSnapshot({ ...SNAPSHOT, markdown });
    expect(viewChars).toBeGreaterThan(text.length);
  });

  it('should bound the form controls, listing the rest after the page (§3.4)', () => {
    const formElements = Array.from({ length: 2_000 }, (_, index) => ({
      isHidden: false,
      kind: 'button' as const,
      label: `Apply filter ${index}`,
      ref: `e${index}`,
      value: ''
    }));
    const { text, viewChars } = renderWebSnapshot({ ...SNAPSHOT, formElements });
    const block = text.slice(0, text.indexOf('# Faculty'));
    expect(block.length).toBeLessThan(FORM_CONTROLS_MAX_CHARS + 500);
    expect(block).toMatch(/\d+ more controls, listed after the page; the rest by reference: results__read find\n\n$/u);
    expect(text.slice(text.indexOf('# Faculty'))).toContain('Form controls, continued:\n- ⟨e');
    expect(viewChars).toBeLessThanOrEqual(FORM_CONTROLS_MAX_CHARS + 500 + SNAPSHOT_VIEW_CHARS);
  });

  it('should name the offset in the result where a grown page first differs (§3.4)', () => {
    const markdown = `${'same '.repeat(14_000)}NEW ROWS`;
    const { text } = renderWebSnapshot({ ...SNAPSHOT, markdown, unchangedPrefixChars: 70_000 });
    const offset = Number(/up to character (\d+) of this result/u.exec(text)?.[1]);
    expect(text.slice(offset)).toBe('NEW ROWS');
  });

  it('should lead with a stale ref, saying nothing was done (§3.4)', () => {
    const { text } = renderWebSnapshot({ ...SNAPSHOT, staleRef: 'e7' });
    expect(text).toMatch(/^⟨e7⟩ is no longer on the page, so nothing was done; the page as it is now follows\n\n/u);
  });

  it('should mark a hidden form control so its ref is not read as actionable', () => {
    const snapshot: WebSnapshot = {
      formElements: [{ isHidden: true, kind: 'input', label: 'Search', ref: 'e1', type: 'text', value: '' }],
      markdown: '# Faculty',
      openedUrls: [],
      status: 200,
      title: 'Faculty',
      url: 'https://northmoor.example/'
    };
    expect(renderWebSnapshot(snapshot).text).toContain(
      '⟨e1⟩ input[type=text] "Search" (hidden — reveal it before acting)'
    );
  });

  it('should show what a filled input holds', () => {
    const snapshot: WebSnapshot = {
      formElements: [{ isHidden: false, kind: 'input', label: 'Search', ref: 'e1', type: 'text', value: 'duval' }],
      markdown: '# Faculty',
      openedUrls: [],
      status: 200,
      title: 'Faculty',
      url: 'https://northmoor.example/'
    };
    expect(renderWebSnapshot(snapshot).text).toContain('⟨e1⟩ input[type=text] "Search" = "duval"');
  });

  it("should list a select's options, counting those past the ones shown (§3.4)", () => {
    const options = Array.from({ length: SELECT_OPTIONS_SHOWN + 2 }, (_, index) => `Option ${index}`);
    const snapshot: WebSnapshot = {
      formElements: [{ isHidden: false, kind: 'select', label: 'Focus', options, ref: 'e1', value: 'Option 0' }],
      markdown: '# Faculty',
      openedUrls: [],
      status: 200,
      title: 'Faculty',
      url: 'https://northmoor.example/'
    };
    const line = renderWebSnapshot(snapshot)
      .text.split('\n')
      .find((candidate) => candidate.startsWith('- ⟨e1⟩'));
    expect(line).toMatch(/^- ⟨e1⟩ select "Focus" = "Option 0"; options: "Option 0", "Option 1", /u);
    expect(line).toMatch(/"Option 99", and 2 more$/u);
  });

  it('should name a tab the page opened, and say when it had no address yet', () => {
    const snapshot: WebSnapshot = {
      formElements: [],
      markdown: '# Faculty',
      openedUrls: ['https://northmoor.example/members', 'about:blank'],
      status: 200,
      title: 'Faculty',
      url: 'https://northmoor.example/'
    };
    const rendered = renderWebSnapshot(snapshot).text;
    expect(rendered).toContain('The page opened a new tab to https://northmoor.example/members; it was closed');
    expect(rendered).toContain('The page opened a new tab to an address it had not yet loaded; it was closed');
  });
});
