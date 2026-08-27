import { Tabs, TabsContent, TabsList, TabsTrigger } from 'fumadocs-ui/components/tabs';

import type { FieldNode, RenderedHtml } from '@/reference/reference.types.ts';
import { cn } from '@/utils/cn.ts';

import { FieldDescription } from './FieldDescription.tsx';
import { FieldSignature } from './FieldSignature.tsx';

type Field = FieldNode<RenderedHtml>;

const VariantTabs = ({ field }: { field: Field }) => (
  <Tabs persist className="mt-3" defaultValue={field.variants[0]?.label} groupId={field.variantGroup}>
    <TabsList>
      {field.variants.map((variant) => (
        <TabsTrigger className="font-mono" key={variant.label} value={variant.label}>
          {variant.label}
        </TabsTrigger>
      ))}
    </TabsList>
    {field.variants.map((variant) => (
      <TabsContent key={variant.label} value={variant.label}>
        <FieldDescription className="mb-3 text-sm" description={variant.description} />
        <FieldList className="[&>*:first-child]:pt-0 [&>*:last-child]:pb-0" fields={variant.children} />
      </TabsContent>
    ))}
  </Tabs>
);

/** What a row holds beneath its description: tabs for a union, a list for an object, nothing for a scalar. */
const FieldBody = ({ field, nested }: { field: Field; nested: boolean }) => {
  if (field.variants.length > 0) {
    return <VariantTabs field={field} />;
  }
  if (field.children.length > 0) {
    return nested ? (
      <FieldList className="border-fd-border mt-3 border-l pl-4 [&>*:last-child]:pb-0" fields={field.children} />
    ) : (
      <FieldList className="border-fd-border border-y" fields={field.children} />
    );
  }
  return null;
};

const FieldRow = ({ field }: { field: Field }) => (
  <div className="border-fd-border scroll-m-28 border-b py-3 last:border-b-0" id={field.id}>
    <FieldSignature field={field} name={field.name} />
    <FieldDescription className="mt-1 text-sm" description={field.description} />
    <FieldBody nested field={field} />
  </div>
);

const FieldList = ({ className, fields }: { className?: string; fields: readonly Field[] }) => (
  <div className={cn('flex flex-col', className)}>
    {fields.map((field) => (
      <FieldRow field={field} key={field.name} />
    ))}
  </div>
);

export { FieldBody, FieldList };
