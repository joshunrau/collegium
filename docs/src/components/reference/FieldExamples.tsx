/** The values a schema offers for a field, as chips: a list an operator can pick from, not a sentence to parse. */
export const FieldExamples = ({ examples }: { examples: readonly string[] }) =>
  examples.length === 0 ? null : (
    <div className="not-prose mt-2 flex flex-wrap items-baseline gap-1.5 font-mono text-xs">
      <span className="text-fd-muted-foreground me-1">e.g.</span>
      {examples.map((example) => (
        <span className="border-fd-border bg-fd-muted rounded-md border px-1.5 py-0.5" key={example}>
          {example}
        </span>
      ))}
    </div>
  );
