import { describe, expect, it } from 'vitest';

import { cloakEmail } from '@/testing/factories/cloudflare.factory.ts';

import { pageToMarkdown, toMarkdown } from '../markdown.utils.ts';

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

describe('pageToMarkdown with Cloudflare-cloaked addresses (§3.4)', () => {
  const hex = cloakEmail('duval@northmoor.example');
  const PAGE_URL = 'https://northmoor.example/people/';

  it('should read a protected mailto link as the address it hides', () => {
    const html = `<p>Write to <a href="/cdn-cgi/l/email-protection#${hex}"><span class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</span></a>.</p>`;
    expect(pageToMarkdown(html, PAGE_URL)).toBe('Write to [duval@northmoor.example](mailto:duval@northmoor.example).');
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
