import { Fragment } from 'react';

import type { ReferencePage, RenderedHtml } from '@/reference/reference.types.ts';

import { FieldSection } from './FieldSection.tsx';
import { FieldList } from './FieldTree.tsx';

/** The island a reference page's body lives in: static rows, hydrated for the variant tabs alone. */
export const ReferenceTree = ({ page }: { page: ReferencePage<RenderedHtml> }) => (
  <>
    {page.sections.map((section) => (
      <Fragment key={section.heading?.id ?? 'lead'}>
        {section.heading && (
          <h2 className="scroll-m-28" id={section.heading.id}>
            {section.heading.text}
          </h2>
        )}
        <div dangerouslySetInnerHTML={{ __html: section.intro.html }} />
        {section.fields &&
          (page.layout === 'sections' ? (
            section.fields.map((field) => <FieldSection field={field} key={field.name} />)
          ) : (
            <FieldList className="border-fd-border border-y" fields={section.fields} />
          ))}
      </Fragment>
    ))}
  </>
);
