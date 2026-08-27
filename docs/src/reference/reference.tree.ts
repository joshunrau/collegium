import type { FieldNode, FieldVariant, JsonSchemaNode } from './reference.types.ts';

const OPEN_RECORD_NOTE = 'Further keys are accepted beyond those listed.';

const json = (value: unknown): string => JSON.stringify(value);

const variantsOf = (node: JsonSchemaNode) => node.oneOf ?? node.anyOf;

const isObject = (node: JsonSchemaNode): boolean => node.type === 'object' || node.properties !== undefined;

/** the type column, in the notation an operator's editor already speaks */
function describeType(node: JsonSchemaNode): string {
  if (node.const !== undefined) {
    return json(node.const);
  }
  if (node.enum) {
    return node.enum.map(json).join(' | ');
  }
  const variants = variantsOf(node);
  if (variants) {
    return variants.every(isObject) ? 'object' : variants.map(describeType).join(' | ');
  }
  if (node.type === 'array') {
    const item = node.items ? describeType(node.items) : 'any';
    return item.includes(' | ') ? `(${item})[]` : `${item}[]`;
  }
  if (typeof node.type === 'string') {
    return node.type;
  }
  return node.type ? node.type.join(' | ') : 'any';
}

type Discriminant = { readonly key: string; readonly values: readonly unknown[] };

/** the property every variant fixes to a constant of its own, when there is one */
function discriminantOf(variants: readonly JsonSchemaNode[]): Discriminant | undefined {
  const [first, ...rest] = variants;
  const key = Object.entries(first?.properties ?? {})
    .filter(([, property]) => property.const !== undefined)
    .map(([name]) => name)
    .find((name) => rest.every((variant) => variant.properties?.[name]?.const !== undefined));
  if (key === undefined) {
    return undefined;
  }
  return { key, values: variants.map((variant) => variant.properties?.[key]?.const) };
}

const exampleText = (example: unknown): string => (typeof example === 'string' ? example : json(example));

function joinParagraphs(...parts: readonly (string | undefined)[]): string | undefined {
  const present = parts.filter((part) => part !== undefined);
  return present.length > 0 ? present.join('\n\n') : undefined;
}

function buildVariant(
  variant: JsonSchemaNode,
  discriminant: Discriminant | undefined,
  index: number
): FieldVariant<string> {
  return {
    children: buildChildren(variant, () => undefined, discriminant?.key),
    description: variant.description,
    label: discriminant ? `${discriminant.key}: ${json(discriminant.values[index])}` : `Variant ${index + 1}`
  };
}

function buildField(name: string, node: JsonSchemaNode, required: boolean, id: string | undefined): FieldNode<string> {
  const item = node.type === 'array' ? node.items : undefined;
  const base = {
    defaultValue: node.default === undefined ? undefined : json(node.default),
    description: node.description,
    examples: (node.examples ?? item?.examples ?? []).map(exampleText),
    id,
    name,
    required,
    type: describeType(node)
  };
  const childId = (child: string) => (id === undefined ? undefined : `${id}.${child}`);
  const variants = variantsOf(node);
  if (variants?.every(isObject)) {
    const discriminant = discriminantOf(variants);
    return {
      ...base,
      children: [],
      variantGroup: discriminant && `${discriminant.key}=${discriminant.values.map(json).join('|')}`,
      variants: variants.map((variant, index) => buildVariant(variant, discriminant, index))
    };
  }
  if (item !== undefined) {
    return {
      ...base,
      children: isObject(item) ? buildChildren(item, childId) : [],
      description: joinParagraphs(node.description, item.description),
      variants: []
    };
  }
  return { ...base, children: isObject(node) ? buildChildren(node, childId) : [], variants: [] };
}

/** an object's rows in schema order, then one trailing row when it accepts keys beyond those listed */
function buildChildren(
  node: JsonSchemaNode,
  childId: (name: string) => string | undefined,
  exclude?: string
): FieldNode<string>[] {
  const required = new Set(node.required ?? []);
  const rows = Object.entries(node.properties ?? {})
    .filter(([name]) => name !== exclude)
    .map(([name, property]) => buildField(name, property, required.has(name), childId(name)));
  if (node.additionalProperties === undefined || node.additionalProperties === false) {
    return rows;
  }
  const rest = typeof node.additionalProperties === 'object' ? node.additionalProperties : {};
  return [
    ...rows,
    {
      children: [],
      description: OPEN_RECORD_NOTE,
      examples: [],
      name: '…',
      required: false,
      type: describeType(rest),
      variants: []
    }
  ];
}

/** The root object's rows, each linked by its dotted path (`app.debounce.windowMs`). */
export function buildFieldTree(schema: JsonSchemaNode): FieldNode<string>[] {
  return buildChildren(schema, (name) => name);
}

/** A row worth jumping to: it holds tabs, or rows that are themselves linkable. */
export function isContainer(field: FieldNode<unknown>): boolean {
  return field.variants.length > 0 || field.children.some((child) => child.id !== undefined);
}

export async function mapFieldDescriptions<TFrom, TTo>(
  fields: readonly FieldNode<TFrom>[],
  map: (description: TFrom) => Promise<TTo>
): Promise<FieldNode<TTo>[]> {
  const mapDescription = async (description: TFrom | undefined) =>
    description === undefined ? undefined : await map(description);
  return Promise.all(
    fields.map(async (field) => ({
      ...field,
      children: await mapFieldDescriptions(field.children, map),
      description: await mapDescription(field.description),
      variants: await Promise.all(
        field.variants.map(async (variant) => ({
          ...variant,
          children: await mapFieldDescriptions(variant.children, map),
          description: await mapDescription(variant.description)
        }))
      )
    }))
  );
}
