/**
 * A keyword of this project's own on a JSON Schema node: a titled table of labelled rows the docs
 * render beneath the field, for what a type alone cannot say — the values the framework ships for
 * a field that stays open to more, say. Editors ignore it.
 */
export type SchemaTableRow = { readonly label: string; readonly values: readonly string[] };

export type SchemaTable = { readonly rows: readonly SchemaTableRow[]; readonly title: string };

export const SCHEMA_TABLE_KEYWORD = 'x-table';

export type SchemaTableMeta = ReturnType<typeof schemaTable>;

export function schemaTable(table: SchemaTable) {
  return { [SCHEMA_TABLE_KEYWORD]: table };
}

/**
 * The values a field ships with, as the branch an editor completes from. A closed `enum` would
 * refuse the plugin names this grammar stays open to, and the TypeScript literal union never
 * reaches a JSON file, so the values are offered by one arm and everything else accepted by the
 * other. Validation stays the node's own check, which runs whichever arm matched.
 */
export function suggestedValues(values: readonly string[]) {
  return values.length === 0 ? {} : { anyOf: [{ enum: [...values] }, { type: 'string' }] };
}
