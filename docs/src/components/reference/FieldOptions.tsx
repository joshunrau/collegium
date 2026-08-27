import type { BuiltinOptions } from '@collegium/config';

/** The built-in values a field accepts: one row per group, its label in a fixed column and its values beside it. */
export const FieldOptions = ({ options }: { options: BuiltinOptions }) =>
  options.length === 0 ? null : (
    <div className="not-prose mt-3 text-xs">
      <span className="text-fd-muted-foreground mb-1 block">Built-in options</span>
      {options.map((group) => (
        <div
          className="border-fd-border grid grid-cols-[7rem_1fr] gap-3 border-t py-1.5 font-mono last:border-b"
          key={group.label}
        >
          <span className="text-fd-foreground">{group.label}</span>
          <span className="text-fd-muted-foreground flex flex-wrap gap-x-5 gap-y-0.5">
            {group.values.map((value) => (
              <span key={value}>{value}</span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
