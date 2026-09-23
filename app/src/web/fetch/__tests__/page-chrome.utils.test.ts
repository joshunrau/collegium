import { describe, expect, it } from 'vitest';

import { pageToMarkdown } from '../../web.utils.ts';
import { stripPageChrome } from '../page-chrome.utils.ts';

const PAGE_URL = 'https://northmoor.example/people/duval';

const readWithoutChrome = (html: string) => pageToMarkdown(stripPageChrome(html) ?? '', PAGE_URL);

describe('stripPageChrome (§3.4)', () => {
  it('should keep the one main landmark alone, with the base its links resolve against', () => {
    const html = `<html><head><base href="https://cdn.northmoor.example/site/"></head><body>
      <div class="menu">Admissions Research Giving</div>
      <div class="wrap"><div role="main"><h1>Duval, P.</h1><a href="cv.html">CV</a></div><aside>Related news</aside></div>
    </body></html>`;
    expect(readWithoutChrome(html)).toBe('# Duval, P.\n\n[CV](https://cdn.northmoor.example/site/cv.html)');
  });

  it('should drop page-level navigation, banner and footer, but keep an article’s own header', () => {
    const html = `<body>
      <header>Northmoor University</header><div role="navigation">Admissions</div>
      <article><header><h1>Duval, P.</h1></header><p>Professor of Psychology</p></article>
      <footer>© Northmoor</footer>
    </body>`;
    expect(readWithoutChrome(html)).toBe('# Duval, P.\n\nProfessor of Psychology');
  });

  it('should fall back to landmarks where a page marks more than one main', () => {
    const html = '<nav>Menu</nav><main><p>One</p></main><main><p>Two</p></main>';
    expect(readWithoutChrome(html)).toBe('One\n\nTwo');
  });

  it('should report nothing to leave out on a page that marks no chrome', () => {
    expect(stripPageChrome('<h1>Duval, P.</h1><p>Professor of Psychology</p>')).toBeUndefined();
  });
});
