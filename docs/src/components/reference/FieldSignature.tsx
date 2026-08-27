import type { ReactNode } from 'react';

import type { FieldNode } from '@/reference/reference.types.ts';
import { cn } from '@/utils/cn.ts';

type FieldSignatureProps = {
  className?: string;
  field: Pick<FieldNode<unknown>, 'defaultValue' | 'required' | 'type'>;
  name?: string;
};

const Pill = ({ children }: { children: ReactNode }) => (
  <span className="border-fd-border bg-fd-muted text-fd-muted-foreground rounded-md border px-1.5 py-0.5 text-xs">
    {children}
  </span>
);

/** The header line of a row, or of a root section when no name is given: type, then how the field may be left. */
export const FieldSignature = ({ className, field, name }: FieldSignatureProps) => (
  <div className={cn('not-prose flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-sm', className)}>
    {name !== undefined && <span className="text-fd-foreground font-medium">{name}</span>}
    <span className="text-fd-muted-foreground">{field.type}</span>
    {field.required ? (
      <Pill>required</Pill>
    ) : field.defaultValue === undefined ? null : (
      <Pill>
        default <span className="text-fd-foreground">{field.defaultValue}</span>
      </Pill>
    )}
  </div>
);
