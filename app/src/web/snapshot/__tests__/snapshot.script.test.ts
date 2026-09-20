// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { toMarkdown } from '../../web.utils.ts';
import { captureSnapshot } from '../snapshot.script.ts';

const FACULTY_DIRECTORY = `<!doctype html><html><body>
  <nav><a href="/">Home</a></nav>
  <h1>Full-Time Faculty</h1>
  <table>
    <thead><tr><th>Name</th><th>Office</th><th>Email</th></tr></thead>
    <tbody>
      <tr>
        <td><a href="https://adeyemi.labs.northmoor.example/">Adeyemi, K.</a></td>
        <td>5030 PDB</td>
        <td><a href="mailto:adeyemi@northmoor.example">adeyemi@northmoor.example</a></td>
      </tr>
      <tr>
        <td>Duval, P.</td>
        <td>217 BSB</td>
        <td><a href="mailto:duval@northmoor.example">duval@northmoor.example</a></td>
      </tr>
    </tbody>
  </table>
</body></html>`;

const loadDocument = (html: string): void => {
  document.open();
  document.write(html);
  document.close();
};

describe('captureSnapshot', () => {
  it('should mark a ref CSS hides, so the model never spends a click on a guaranteed timeout', () => {
    loadDocument(`<!doctype html><html><body>
      <a id="open" href="/menu">Menu</a>
      <a id="buried" href="/people" style="visibility:hidden">Faculty</a>
    </body></html>`);
    const capture = captureSnapshot(0);
    const refOf = (id: string): string => document.getElementById(id)!.getAttribute('data-collegium-ref')!;
    expect(capture.html).toContain(`⟨${refOf('buried')}⟩ (hidden)`);
    expect(capture.html).toContain(`⟨${refOf('open')}⟩`);
    expect(capture.html).not.toContain(`⟨${refOf('open')}⟩ (hidden)`);
  });

  it('should stamp every interactable with a unique ref and advance the index', () => {
    loadDocument(FACULTY_DIRECTORY);
    const capture = captureSnapshot(0);
    const refs = [...document.querySelectorAll('[data-collegium-ref]')].map((element) => {
      return element.getAttribute('data-collegium-ref');
    });
    expect(refs.length).toBeGreaterThan(0);
    expect(new Set(refs).size).toBe(refs.length);
    expect(capture.nextRefIndex).toBe(refs.length);
  });

  it('should reuse existing stamps and number only new elements, so a stale ref can never alias', () => {
    loadDocument(FACULTY_DIRECTORY);
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
    loadDocument(FACULTY_DIRECTORY);
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
    loadDocument(FACULTY_DIRECTORY);
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
    expect(capture.formElements).toContainEqual({
      isHidden: false,
      kind: 'input',
      label: 'Search people',
      ref: expect.stringMatching(/^e\d+$/),
      type: 'search',
      value: 'duval'
    });
    expect(capture.formElements).toContainEqual(expect.objectContaining({ kind: 'button', label: 'Go' }));
    expect(capture.formElements.map((element) => element.kind)).toEqual(expect.arrayContaining(['select', 'textarea']));
    const excluded = capture.formElements.filter(
      (element) => element.label === 'Export' || element.label === 'Load more'
    );
    expect(excluded).toStrictEqual([]);
  });
});
