import type { FieldNode, RenderedHtml } from '@/reference/reference.types.ts';

import { FieldDescription } from './FieldDescription.tsx';
import { FieldExamples } from './FieldExamples.tsx';
import { FieldSignature } from './FieldSignature.tsx';
import { FieldBody } from './FieldTree.tsx';

/** A root key under the `sections` layout: its own heading, then the same signature, description and body a row carries. */
export const FieldSection = ({ field }: { field: FieldNode<RenderedHtml> }) => (
  <section>
    <h2 className="scroll-m-28" id={field.id}>
      {field.name}
    </h2>
    <FieldSignature className="-mt-4 mb-4" field={field} />
    <FieldDescription className="mb-4" description={field.description} />
    <FieldExamples examples={field.examples} />
    <FieldBody field={field} nested={false} />
  </section>
);
