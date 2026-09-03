// @vitest-environment happy-dom
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { toMarkdown } from '../../web.utils.ts';
import { captureSnapshot } from '../snapshot.script.ts';

const fixture = (name: string): string => {
  return fs.readFileSync(path.resolve(import.meta.dirname, '../../__tests__/fixtures', `${name}.html`), 'utf-8');
};

const loadDocument = (html: string): void => {
  document.open();
  document.write(html);
  document.close();
};

describe('captureSnapshot', () => {
  it('should stamp every interactable with a unique ref and advance the index', () => {
    loadDocument(fixture('static-directory'));
    const capture = captureSnapshot(0);
    const refs = [...document.querySelectorAll('[data-collegium-ref]')].map((element) => {
      return element.getAttribute('data-collegium-ref');
    });
    expect(refs.length).toBeGreaterThan(0);
    expect(new Set(refs).size).toBe(refs.length);
    expect(capture.nextRefIndex).toBe(refs.length);
  });

  it('should reuse existing stamps and number only new elements, so a stale ref can never alias', () => {
    loadDocument(fixture('static-directory'));
    const first = captureSnapshot(0);
    const anchor = document.querySelector('a[href]');
    const stamp = anchor?.getAttribute('data-collegium-ref');
    const second = captureSnapshot(first.nextRefIndex);
    expect(anchor?.getAttribute('data-collegium-ref')).toBe(stamp);
    expect(second.nextRefIndex).toBe(first.nextRefIndex);
    const added = document.createElement('a');
    added.setAttribute('href', '/added');
    added.textContent = 'Added';
    document.body.append(added);
    const third = captureSnapshot(second.nextRefIndex);
    expect(added.getAttribute('data-collegium-ref')).toBe(`e${second.nextRefIndex}`);
    expect(third.nextRefIndex).toBe(second.nextRefIndex + 1);
  });

  it('should land each marker beside its element, so a ref stays in its own table row', () => {
    loadDocument(fixture('static-directory'));
    const capture = captureSnapshot(0);
    const anchor = [...document.querySelectorAll('a[href]')].find(
      (element) => element.getAttribute('href') === 'mailto:duval@northmoor.example'
    );
    const ref = anchor?.getAttribute('data-collegium-ref');
    expect(ref).toBeDefined();
    const row = toMarkdown(capture.html)
      .split('\n')
      .find((line) => line.includes('Duval, P.'));
    expect(row).toContain(`⟨${ref}⟩`);
  });

  it('should never write marker text into the live document', () => {
    loadDocument(fixture('static-directory'));
    captureSnapshot(0);
    expect(document.body.textContent).not.toContain('⟨');
  });

  it('should describe the form controls that markdown drops, and only those', () => {
    loadDocument(`<!doctype html><html><body>
      <label for="q">Search people</label>
      <input id="q" name="q" type="search" value="duval" />
      <input name="csrf" type="hidden" value="token" />
      <button type="submit">Go</button>
      <button disabled>Export</button>
      <select name="department"><option>Psychology</option></select>
      <textarea placeholder="Notes"></textarea>
      <span role="button">Load more</span>
    </body></html>`);
    const capture = captureSnapshot(0);
    // §3.4 — that it holds text, never which text: the tool signs in, so an input's contents are
    // credentials as often as not
    expect(capture.formElements).toContainEqual({
      isFilled: true,
      kind: 'input',
      label: 'Search people',
      ref: expect.stringMatching(/^e\d+$/),
      type: 'search'
    });
    expect(JSON.stringify(capture.formElements)).not.toContain('duval');
    expect(capture.formElements).toContainEqual(expect.objectContaining({ kind: 'button', label: 'Go' }));
    expect(capture.formElements.map((element) => element.kind)).toEqual(expect.arrayContaining(['select', 'textarea']));
    const excluded = capture.formElements.filter(
      (element) => element.label === 'Export' || element.label === 'Load more'
    );
    expect(excluded).toStrictEqual([]);
  });
});
