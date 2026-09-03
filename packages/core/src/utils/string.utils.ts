/** the `{name}` placeholders a template carries, read off its own text */
export type Placeholders<TTemplate extends string> = TTemplate extends `${string}{${infer TName}}${infer TRest}`
  ? Placeholders<TRest> | TName
  : never;

/** fills every `{name}` placeholder; the template's own text decides which names are required */
export function format<TTemplate extends string>(
  template: TTemplate,
  values: { readonly [K in Placeholders<TTemplate>]: number | string }
): string {
  return Object.entries<number | string>(values).reduce<string>(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template
  );
}

export function removeTrailingSlash(s: string) {
  return s.replace(/\/$/, '');
}

export function uncapitalize<T extends string>(s: T): Uncapitalize<T> {
  return (s.charAt(0).toLowerCase() + s.slice(1)) as Uncapitalize<T>;
}
