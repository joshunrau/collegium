import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';

/** node-html-markdown's own parse options, so the tree judged here is the tree it then converts */
const PARSE_OPTIONS = {
  blockTextElements: { noscript: false, script: false, style: false },
  comment: false,
  fixNestedATags: true,
  lowerCaseTagName: true
};

const MAIN_CONTENT = 'main, [role="main"]';

const CHROME_LANDMARKS = 'nav, [role="banner"], [role="navigation"], [role="contentinfo"]';

/** a header or footer inside one of these is that section's own — an article's title and byline — not the page's */
const SECTIONING = 'article, aside, main, nav, section';

function isOutsideAny(element: HTMLElement, selector: string): boolean {
  return element.parentNode.closest(selector) === null;
}

/**
 * §3.4 — a fetched page as HTML with its chrome left out, for the same conversion the whole page
 * gets: where the page marks exactly one main landmark, that alone; otherwise the page less its
 * navigation and its page-level banner and footer. Undefined when the page marks none of these,
 * since there is then nothing to leave out.
 */
export function stripPageChrome(html: string): string | undefined {
  const root = parse(html, PARSE_OPTIONS);
  const mains = root.querySelectorAll(MAIN_CONTENT).filter((element) => isOutsideAny(element, MAIN_CONTENT));
  if (mains.length === 1) {
    // the body, not the root, so the head and the base address a link resolves against survive
    (root.querySelector('body') ?? root).set_content(mains[0]!);
    return root.toString();
  }
  const chrome = [
    ...root.querySelectorAll(CHROME_LANDMARKS),
    ...root.querySelectorAll('header, footer').filter((element) => isOutsideAny(element, SECTIONING))
  ];
  if (chrome.length === 0) {
    return undefined;
  }
  for (const element of chrome) {
    element.remove();
  }
  return root.toString();
}
