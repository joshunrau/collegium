import { describe, expect, it } from 'vitest';

import { renderSearchMarkdown } from '../reference.search.ts';
import { referenceToc } from '../reference.toc.ts';
import { buildFieldTree } from '../reference.tree.ts';

import type { ReferencePage } from '../reference.types.ts';

const fields = buildFieldTree({
  properties: {
    app: {
      description: 'App-wide.',
      properties: {
        debounce: { properties: { windowMs: { default: 750, type: 'integer' } }, type: 'object' },
        timezone: { type: 'string' }
      },
      type: 'object'
    },
    mode: { oneOf: [{ properties: { kind: { const: 'a' } }, type: 'object' }] }
  },
  type: 'object'
});

const sections: ReferencePage<string> = { layout: 'sections', sections: [{ fields, intro: 'Every field.' }] };

const list: ReferencePage<string> = {
  layout: 'list',
  sections: [
    { fields, intro: 'Read at boot.' },
    { heading: { id: 'compose-only', text: 'Compose only' }, intro: 'Never seen by the app.' }
  ]
};

describe('referenceToc', () => {
  it('should list each root key and the container rows beneath it under the sections layout', () => {
    expect(referenceToc(sections)).toEqual([
      { depth: 2, title: 'app', url: '#app' },
      { depth: 3, title: 'debounce', url: '#app.debounce' },
      { depth: 2, title: 'mode', url: '#mode' }
    ]);
  });

  it('should list the section headings under the list layout', () => {
    expect(referenceToc(list)).toEqual([{ depth: 2, title: 'Compose only', url: '#compose-only' }]);
  });
});

describe('renderSearchMarkdown', () => {
  it('should head root keys and container rows with the ids the page anchors by', () => {
    const markdown = renderSearchMarkdown(sections);
    expect(markdown).toContain('## app [#app]\n\nApp-wide.\n\n### debounce [#app.debounce]');
    expect(markdown).toContain('`windowMs`\n\n`timezone`\n\n## mode [#mode]\n\nkind: "a"');
  });

  it('should keep the written section headings under the list layout', () => {
    expect(renderSearchMarkdown(list)).toContain(
      'kind: "a"\n\n## Compose only [#compose-only]\n\nNever seen by the app.'
    );
  });
});
