import { isContainer } from './reference.tree.ts';

import type { FieldNode, FieldVariant, ReferencePage } from './reference.types.ts';

const heading = (level: number, text: string, id: string) => `${'#'.repeat(level)} ${text} [#${id}]`;

const renderBody = (field: FieldNode<string>): string[] => [
  ...field.options.map((group) => `Built-in options: ${group.join(', ')}`),
  ...field.children.flatMap(renderRow),
  ...field.variants.flatMap(renderVariant)
];

function renderRow(field: FieldNode<string>): string[] {
  return [
    ...(field.id !== undefined && isContainer(field) ? [heading(3, field.name, field.id)] : []),
    field.description === undefined ? `\`${field.name}\`` : `\`${field.name}\` — ${field.description}`,
    ...renderBody(field)
  ];
}

function renderVariant(variant: FieldVariant<string>): string[] {
  return [
    variant.label,
    ...(variant.description === undefined ? [] : [variant.description]),
    ...variant.children.flatMap(renderRow)
  ];
}

function renderRootSection(field: FieldNode<string>): string[] {
  return [
    heading(2, field.name, field.name),
    ...(field.description === undefined ? [] : [field.description]),
    ...renderBody(field)
  ];
}

/**
 * The page as markdown for the search index alone, carrying the same heading ids the rendered tree
 * does, so a hit lands on the row it names.
 */
export function renderSearchMarkdown(page: ReferencePage<string>): string {
  return page.sections
    .flatMap((section) => [
      ...(section.heading ? [heading(2, section.heading.text, section.heading.id)] : []),
      section.intro,
      ...(section.fields ?? []).flatMap(page.layout === 'sections' ? renderRootSection : renderRow)
    ])
    .join('\n\n')
    .concat('\n');
}
