/**
 * The draft-7 subset `z.toJSONSchema` emits for the schemas this site documents. Interior data —
 * produced in-process from the package's own Zod schemas — so a plain type, not a perimeter.
 */
export type JsonSchemaNode = {
  readonly additionalProperties?: boolean | JsonSchemaNode;
  readonly anyOf?: readonly JsonSchemaNode[];
  readonly const?: unknown;
  readonly default?: unknown;
  readonly description?: string;
  readonly enum?: readonly unknown[];
  readonly items?: JsonSchemaNode;
  readonly oneOf?: readonly JsonSchemaNode[];
  readonly properties?: { readonly [key: string]: JsonSchemaNode };
  readonly required?: readonly string[];
  readonly type?: readonly string[] | string;
};

/** A description once the loader has run it through the markdown pipeline; before that it is the schema's own string. */
export type RenderedHtml = { readonly html: string };

export type FieldVariant<TDescription> = {
  readonly children: readonly FieldNode<TDescription>[];
  readonly description?: TDescription;
  readonly label: string;
};

/** One row of a reference page: a property, or an open record's trailing note (`…`). An array row describes its items too. */
export type FieldNode<TDescription> = {
  readonly children: readonly FieldNode<TDescription>[];
  readonly defaultValue?: string;
  readonly description?: TDescription;
  /** The dotted path an always-visible row is linked by. Absent inside a variant tab, where a hidden target cannot be scrolled to. */
  readonly id?: string;
  readonly name: string;
  readonly required: boolean;
  readonly type: string;
  /** Shared by every tab set keyed on the same discriminant and values, so they select together. */
  readonly variantGroup?: string;
  readonly variants: readonly FieldVariant<TDescription>[];
};

/** `sections`: each root key is a headed section of its own. `list`: the root's fields are one list under the section heading. */
export type ReferenceLayout = 'list' | 'sections';

export type ReferenceSection<TDescription> = {
  readonly fields?: readonly FieldNode<TDescription>[];
  readonly heading?: { readonly id: string; readonly text: string };
  readonly intro: TDescription;
};

export type ReferencePage<TDescription> = {
  readonly layout: ReferenceLayout;
  readonly sections: readonly ReferenceSection<TDescription>[];
};
