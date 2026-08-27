/**
 * A keyword of this project's own on a JSON Schema node: every value the framework ships for a
 * field that stays open to more (plugin grants, say), in labelled groups. Editors ignore it; the
 * docs render it. Not `examples` — the set is complete for what the framework provides.
 */
export type BuiltinOptionGroup = { readonly label: string; readonly values: readonly string[] };

export type BuiltinOptions = readonly BuiltinOptionGroup[];

export const BUILTIN_OPTIONS_KEYWORD = 'x-builtin-options';

export type BuiltinOptionsMeta = ReturnType<typeof builtinOptions>;

export function builtinOptions(groups: BuiltinOptions) {
  return { [BUILTIN_OPTIONS_KEYWORD]: groups };
}
