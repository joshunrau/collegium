import type { RenderedHtml } from '@/reference/reference.types.ts';
import { cn } from '@/utils/cn.ts';

type FieldDescriptionProps = {
  className?: string;
  description: RenderedHtml | undefined;
};

export const FieldDescription = ({ className, description }: FieldDescriptionProps) =>
  description === undefined ? null : (
    <div className={cn('prose-no-margin', className)} dangerouslySetInnerHTML={{ __html: description.html }} />
  );
