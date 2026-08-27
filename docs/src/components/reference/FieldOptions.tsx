import type { BuiltinOptions } from '@collegium/config';

/** The built-in values a field accepts, one row of chips per group, beneath the description that says what else it takes. */
export const FieldOptions = ({ options }: { options: BuiltinOptions }) =>
  options.length === 0 ? null : (
    <div className="not-prose mt-2 flex flex-col gap-1.5 text-xs">
      <span className="text-fd-muted-foreground">Built-in options</span>
      {options.map((group) => (
        <div className="flex flex-wrap gap-1.5 font-mono" key={group.join(' ')}>
          {group.map((value) => (
            <span className="border-fd-border bg-fd-muted rounded-md border px-1.5 py-0.5" key={value}>
              {value}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
