import type { SchemaTable } from '@collegium/config';

/** The table a schema attaches to a field: its title, then one row per label with the values beside it. */
export const FieldTable = ({ table }: { table: SchemaTable | undefined }) => {
  return table === undefined ? null : (
    <div className="not-prose mt-3 text-xs">
      <span className="text-fd-muted-foreground mb-1 block">{table.title}</span>
      {table.rows.map((row) => (
        <div
          className="border-fd-border grid grid-cols-[7rem_1fr] gap-3 border-t py-1.5 font-mono last:border-b"
          key={row.label}
        >
          <span className="text-fd-foreground">{row.label}</span>
          <span className="text-fd-muted-foreground flex flex-wrap gap-x-5 gap-y-0.5">
            {row.values.map((value) => (
              <span key={value}>{value}</span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
};
