import { describe, expect, it } from 'vitest';

import { MARKDOWN_CAP_CHARS } from '../web.constants.ts';
import { capMarkdown, renderWebFailure, renderWebSnapshot, toMarkdown } from '../web.utils.ts';

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

  it('should resolve link and image addresses against the page, leaving the rest as authored', () => {
    const html = `<html><body>
      <a href="/people/duval">Duval</a>
      <a href="//cdn.northmoor.example/cv.pdf">CV</a>
      <a href="#top">Top</a>
      <a href="https://other.example/x">Other</a>
      <a href="mailto:duval@northmoor.example">Mail</a>
      <a href="javascript:Fiche(37)">Fiche</a>
      <a href="http://[bad">Broken</a>
      <img src="../img/duval.jpg" alt="Portrait" />
      <table><tr><td><a href="profile?id=7">Row link</a></td></tr></table>
    </body></html>`;
    const markdown = toMarkdown(html, 'https://northmoor.example/dept/psychology/');
    expect(markdown).toContain('[Duval](https://northmoor.example/people/duval)');
    expect(markdown).toContain('[CV](https://cdn.northmoor.example/cv.pdf)');
    expect(markdown).toContain('[Top](https://northmoor.example/dept/psychology/#top)');
    expect(markdown).toContain('[Other](https://other.example/x)');
    expect(markdown).toContain('[Mail](mailto:duval@northmoor.example)');
    expect(markdown).toContain('[Fiche](javascript:Fiche%2837%29)');
    expect(markdown).toContain('[Broken](http://[bad)');
    expect(markdown).toContain('![Portrait](https://northmoor.example/dept/img/duval.jpg)');
    expect(markdown).toContain('[Row link](https://northmoor.example/dept/psychology/profile?id=7)');
  });

  it('should resolve against a declared base, and leave addresses alone with no page URL', () => {
    const html =
      '<html><head><base href="https://cdn.northmoor.example/site/"></head><body><a href="a.html">A</a></body></html>';
    expect(toMarkdown(html, 'https://northmoor.example/dept/')).toContain(
      '[A](https://cdn.northmoor.example/site/a.html)'
    );
    expect(toMarkdown('<a href="a.html">A</a>')).toContain('[A](a.html)');
  });

  /** the empty string is why the render assertion exists: an unrendered page reads as "no results" */
  it.each(Object.entries(CLIENT_RENDERED_PAGES))(
    'should yield nothing at all from %s, since no script has run',
    (_name, html) => {
      expect(toMarkdown(html)).toBe('');
    }
  );
});

describe('capMarkdown', () => {
  it('should leave any page a real site would serve untouched', () => {
    expect(capMarkdown(toMarkdown(STATIC_DIRECTORY))).toContain('| Duval, P. |');
  });

  it('should cut a page past the guard and say so, rather than shortening it silently', () => {
    const capped = capMarkdown('x'.repeat(MARKDOWN_CAP_CHARS + 1));
    expect(capped).toBe(`${'x'.repeat(MARKDOWN_CAP_CHARS)}\n…page truncated at ${MARKDOWN_CAP_CHARS} characters`);
  });
});

describe('renderWebFailure', () => {
  it('should tell the model which tool can read a page that needs client rendering', () => {
    expect(renderWebFailure({ kind: 'no-static-content', url: 'https://northmoor.example/' })).toBe(
      'the page at https://northmoor.example/ has no readable content without JavaScript — open it with web::navigate instead'
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
