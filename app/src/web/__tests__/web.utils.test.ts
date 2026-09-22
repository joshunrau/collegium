import { describe, expect, it } from 'vitest';

import { DEFAULT_WINDOW_CHARS, MARKDOWN_CAP_CHARS } from '../web.constants.ts';
import {
  capMarkdown,
  decodeCloudflareEmail,
  describeWebFailureOutcome,
  pageToMarkdown,
  renderWebFailure,
  renderWebSnapshot,
  toMarkdown,
  windowMarkdown
} from '../web.utils.ts';

import type { WebSnapshot } from '../web.types.ts';

const STATIC_PAGE = `<!doctype html><html><head><title>Research Themes</title></head><body>
  <h1>Research Themes</h1>
  <ul>
    <li>Cognitive development across the lifespan</li>
    <li>Computational models of perception</li>
  </ul>
  <p>Enquiries go to <a href="mailto:research@northmoor.example">research@northmoor.example</a>.</p>
</body></html>`;

const STATIC_DIRECTORY = `<!doctype html><html><head><title>Faculty</title></head><body>
  <table>
    <thead><tr><th>Name</th><th>Office</th><th>Extension</th><th>Email</th></tr></thead>
    <tbody>
      <tr><td>Adeyemi, K.</td><td>214 BSB</td><td>4102</td><td><a href="mailto:adeyemi@northmoor.example">adeyemi@northmoor.example</a></td></tr>
      <tr><td>Duval, P.</td><td>217 BSB</td><td>—</td><td><a href="mailto:duval@northmoor.example">duval@northmoor.example</a></td></tr>
    </tbody>
  </table>
</body></html>`;

/** Cloudflare's cloak as its edge writes it: a key byte, then each byte of the address XORed with that key */
function cloak(address: string, key = 0x5a): string {
  return [key, ...new TextEncoder().encode(address).map((byte) => byte ^ key)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** a shell whose every word arrives by script: nothing for markdown to carry */
const CLIENT_RENDERED_PAGES = {
  'client-rendered-directory':
    '<!doctype html><html><head><title>Faculty</title></head><body><div id="directory"></div><script src="/directory.js"></script></body></html>',
  'spa-marketing-site':
    '<!doctype html><html><head><title>Northmoor</title></head><body><div id="app"></div><script src="/app.js"></script></body></html>'
};

describe('toMarkdown', () => {
  it('should carry headings, lists, and inline links across from a static page', () => {
    const markdown = toMarkdown(STATIC_PAGE);
    expect(markdown).toContain('# Research Themes');
    expect(markdown).toContain('* Cognitive development across the lifespan');
    expect(markdown).toContain('[research@northmoor.example](mailto:research@northmoor.example)');
  });

  it('should keep a faculty table as a table, so a name stays beside its own email', () => {
    const markdown = toMarkdown(STATIC_DIRECTORY);
    expect(markdown).toContain('| Name | Office | Extension | Email |');
    expect(markdown).toContain(
      '| Duval, P. | 217 BSB | — | [duval@northmoor.example](mailto:duval@northmoor.example) |'
    );
  });

  it('should collapse the alignment padding that carries nothing for a model', () => {
    expect(toMarkdown(STATIC_DIRECTORY)).not.toMatch(/ {2,}/);
  });

  it('should drop a doctype with a public identifier rather than read it as text', () => {
    const html =
      '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN"><html><body><div>Hello</div></body></html>';
    expect(toMarkdown(html)).toBe('Hello');
  });

  it('should resolve link addresses against the page, leaving the rest as authored', () => {
    const html = `<html><body>
      <a href="/people/duval">Duval</a>
      <a href="//cdn.northmoor.example/cv.pdf">CV</a>
      <a href="#top">Top</a>
      <a href="https://other.example/x">Other</a>
      <a href="mailto:duval@northmoor.example">Mail</a>
      <a href="javascript:Fiche(37)">Fiche</a>
      <a href="http://[bad">Broken</a>
      <table><tr><td><a href="profile?id=7">Row link</a></td></tr></table>
    </body></html>`;
    const markdown = pageToMarkdown(html, 'https://northmoor.example/dept/psychology/');
    expect(markdown).toContain('[Duval](https://northmoor.example/people/duval)');
    expect(markdown).toContain('[CV](https://cdn.northmoor.example/cv.pdf)');
    expect(markdown).toContain('[Top](https://northmoor.example/dept/psychology/#top)');
    expect(markdown).toContain('[Other](https://other.example/x)');
    expect(markdown).toContain('[Mail](mailto:duval@northmoor.example)');
    expect(markdown).toContain('[Fiche](javascript:Fiche%2837%29)');
    expect(markdown).toContain('[Broken](http://[bad)');
    expect(markdown).toContain('[Row link](https://northmoor.example/dept/psychology/profile?id=7)');
  });

  it('should resolve against a declared base, and leave addresses alone with no page behind the HTML', () => {
    const html =
      '<html><head><base href="https://cdn.northmoor.example/site/"></head><body><a href="a.html">A</a></body></html>';
    expect(pageToMarkdown(html, 'https://northmoor.example/dept/')).toContain(
      '[A](https://cdn.northmoor.example/site/a.html)'
    );
    expect(toMarkdown('<a href="a.html">A</a>')).toContain('[A](a.html)');
  });

  it('should read a page image as its alt text, and leave out one described as nothing (§3.4)', () => {
    const html =
      '<p><img src="/img/duval.jpg" alt="Portrait of P. Duval" /><img src="/img/rule.png" alt="" /></p>' +
      '<table><tr><td><img src="/img/lab.jpg" alt="The lab" /></td></tr></table>';
    const markdown = pageToMarkdown(html, 'https://northmoor.example/people/');
    expect(markdown).toContain('[image: Portrait of P. Duval]');
    expect(markdown).toContain('| [image: The lab] |');
    expect(markdown).not.toContain('/img/');
  });

  it('should keep a mail body’s images as authored', () => {
    expect(toMarkdown('<img src="https://northmoor.example/logo.png" alt="Logo" />')).toBe(
      '![Logo](https://northmoor.example/logo.png)'
    );
  });

  /** the empty string is why the render assertion exists: an unrendered page reads as "no results" */
  it.each(Object.entries(CLIENT_RENDERED_PAGES))(
    'should yield nothing at all from %s, since no script has run',
    (_name, html) => {
      expect(toMarkdown(html)).toBe('');
    }
  );
});

describe('decodeCloudflareEmail', () => {
  it('should decode a cloaked address as the decoder script would', () => {
    expect(decodeCloudflareEmail(cloak('duval@northmoor.example'))).toBe('duval@northmoor.example');
  });

  it.each([
    ['an odd-length cipher', cloak('duval@northmoor.example').slice(0, -1)],
    ['a cipher that is not hex', 'zz'.repeat(8)],
    ['a cipher that decodes to no address', cloak('not an address')]
  ])('should refuse %s rather than guess', (_name, hex) => {
    expect(decodeCloudflareEmail(hex)).toBeUndefined();
  });
});

describe('pageToMarkdown with Cloudflare-cloaked addresses (§3.4)', () => {
  const hex = cloak('duval@northmoor.example');
  const PAGE_URL = 'https://northmoor.example/people/';

  it('should read a protected mailto link as the address it hides', () => {
    const html = `<p>Write to <a href="/cdn-cgi/l/email-protection#${hex}"><span class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</span></a>.</p>`;
    expect(pageToMarkdown(html, PAGE_URL)).toBe(
      'Write to [duval@northmoor.example](mailto:duval@northmoor.example).'
    );
  });

  it('should read a cloaked address in a table cell, where a directory keeps it', () => {
    const html = `<table><tr><th>Name</th><th>Email</th></tr><tr><td>Duval, P.</td><td><a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</a></td></tr></table>`;
    expect(pageToMarkdown(html, PAGE_URL)).toContain('| Duval, P. | duval@northmoor.example |');
  });

  it('should leave a link it cannot decode as it was served', () => {
    const html = '<a href="/cdn-cgi/l/email-protection#zz">[email&#160;protected]</a>';
    const markdown = pageToMarkdown(html, PAGE_URL);
    expect(markdown).toContain('(https://northmoor.example/cdn-cgi/l/email-protection#zz)');
    expect(markdown).not.toContain('mailto:');
  });
});

describe('capMarkdown', () => {
  it('should leave any page a real site would serve untouched', () => {
    expect(capMarkdown(toMarkdown(STATIC_DIRECTORY))).toStrictEqual({
      markdown: expect.stringContaining('| Duval, P. |')
    });
  });

  it('should say how much of the page it cut, not only where it cut it', () => {
    const capped = capMarkdown('x'.repeat(MARKDOWN_CAP_CHARS + 1));
    expect(capped).toStrictEqual({
      markdown: `${'x'.repeat(MARKDOWN_CAP_CHARS)}\n…page truncated at ${MARKDOWN_CAP_CHARS} of ${MARKDOWN_CAP_CHARS + 1} characters`,
      shown: { from: 0, to: MARKDOWN_CAP_CHARS, total: MARKDOWN_CAP_CHARS + 1 }
    });
  });
});

describe('windowMarkdown (§3.8)', () => {
  it('should state that a page ended where the result ended (§3.8)', () => {
    expect(windowMarkdown('short', 0)).toStrictEqual({ markdown: 'short\n…end of page, 5 characters in all' });
  });

  it('should read a page past the default window in parts, saying where to read on and how to reach the end', () => {
    const total = DEFAULT_WINDOW_CHARS + 10;
    const windowed = windowMarkdown('x'.repeat(total), 0);
    expect(windowed.markdown).toMatch(
      new RegExp(
        `x\\n…showing characters 0–${DEFAULT_WINDOW_CHARS} of ${total}; read on with startChar=${DEFAULT_WINDOW_CHARS}, or startChar=-20000 for the end$`,
        'u'
      )
    );
    expect(windowed.shown).toStrictEqual({ from: 0, to: DEFAULT_WINDOW_CHARS, total });
  });

  it('should never read past the guard, whatever width is asked for', () => {
    const total = MARKDOWN_CAP_CHARS + 10;
    expect(windowMarkdown('x'.repeat(total), 0, total).shown).toStrictEqual({ from: 0, to: MARKDOWN_CAP_CHARS, total });
  });

  it('should return only the requested window and still say where to read on', () => {
    expect(windowMarkdown('0123456789', 0, 4)).toStrictEqual({
      markdown: '0123\n…showing characters 0–4 of 10; read on with startChar=4, or startChar=-20000 for the end',
      shown: { from: 0, to: 4, total: 10 }
    });
  });

  it('should read a negative startChar as an offset from the end of the page', () => {
    expect(windowMarkdown('0123456789', -3)).toStrictEqual({
      markdown: '789\n…showing characters 7–10 of 10',
      shown: { from: 7, to: 10, total: 10 }
    });
  });

  it('should read from the offset to the end, and say so without an invitation to read on', () => {
    expect(windowMarkdown('0123456789', 7)).toStrictEqual({
      markdown: '789\n…showing characters 7–10 of 10',
      shown: { from: 7, to: 10, total: 10 }
    });
  });

  it('should say when the offset is past the end rather than return nothing', () => {
    expect(windowMarkdown('0123456789', 10).markdown).toBe(
      '…startChar 10 is past the end of this page, which has 10 characters'
    );
  });
});

describe('renderWebFailure', () => {
  it('should tell the model which tool can read a page that needs client rendering, and the status it got', () => {
    expect(renderWebFailure({ kind: 'no-static-content', status: 200, url: 'https://northmoor.example/' })).toBe(
      'the page at https://northmoor.example/ answered HTTP 200 and has no readable content without JavaScript — open it with web::navigate instead'
    );
  });

  it('should not name web::navigate for a page the server said is not there', () => {
    const line = renderWebFailure({
      bodyChars: 0,
      kind: 'http-error',
      status: 404,
      url: 'https://northmoor.example/gone'
    });
    expect(line).toBe(
      'https://northmoor.example/gone answered HTTP 404 with 0 characters of body and nothing readable in it; there is no page there, and a browser will not find one'
    );
    expect(line).not.toContain('web::navigate');
  });

  it('should carry the status on a page that rendered nothing', () => {
    expect(renderWebFailure({ kind: 'empty-render', status: 404, url: 'https://northmoor.example/gone' })).toBe(
      'the page at https://northmoor.example/gone answered HTTP 404 and rendered no readable content'
    );
  });

  it('should name the content type it cannot read', () => {
    expect(
      renderWebFailure({
        contentType: 'application/pdf',
        kind: 'unsupported-content',
        url: 'https://northmoor.example/a.pdf'
      })
    ).toBe('https://northmoor.example/a.pdf is application/pdf, which this tool cannot read as text');
  });

  it('should name hover as the way out of a ref CSS hides', () => {
    expect(renderWebFailure({ kind: 'not-visible', ref: 'e12' })).toContain('web::hover');
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
    expect(describeWebFailureOutcome({ kind: 'stale-ref', ref: 'e7' })).toBe('⚠️ stale ref');
    expect(
      describeWebFailureOutcome({ kind: 'url-refused', reason: 'not-public-host', url: 'https://10.0.0.1/' })
    ).toBe('⚠️ refused');
  });
});

describe('renderWebSnapshot', () => {
  it('should mark a hidden form control so its ref is not read as actionable', () => {
    const snapshot: WebSnapshot = {
      formElements: [{ isHidden: true, kind: 'input', label: 'Search', ref: 'e1', type: 'text', value: '' }],
      markdown: '# Faculty',
      openedUrls: [],
      status: 200,
      title: 'Faculty',
      url: 'https://northmoor.example/'
    };
    expect(renderWebSnapshot(snapshot)).toContain('⟨e1⟩ input[type=text] "Search" (hidden — reveal it before acting)');
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
    expect(renderWebSnapshot(snapshot)).toContain('⟨e1⟩ input[type=text] "Search" = "duval"');
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
    const rendered = renderWebSnapshot(snapshot);
    expect(rendered).toContain('The page opened a new tab to https://northmoor.example/members; it was closed');
    expect(rendered).toContain('The page opened a new tab to an address it had not yet loaded; it was closed');
  });
});
