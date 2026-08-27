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
