import type { TOCItemType } from 'fumadocs-core/toc';

import { isContainer } from './reference.tree.ts';

import type { ReferencePage } from './reference.types.ts';

/** The rail: section headings under `list`; under `sections`, each root key and the container rows one level beneath it. */
export function referenceToc(page: ReferencePage<unknown>): TOCItemType[] {
  if (page.layout === 'list') {
    return page.sections.flatMap((section) => {
      return section.heading ? [{ depth: 2, title: section.heading.text, url: `#${section.heading.id}` }] : [];
    });
  }
  return page.sections.flatMap((section) => {
    return (section.fields ?? []).flatMap((field) => [
      { depth: 2, title: field.name, url: `#${field.name}` },
      ...field.children.flatMap((child) => {
        return child.id !== undefined && isContainer(child)
          ? [{ depth: 3, title: child.name, url: `#${child.id}` }]
          : [];
      })
    ]);
  });
}
