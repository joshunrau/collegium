/**
 * The draft-7 subset `z.toJSONSchema` emits for the schemas this site documents. Interior data —
 * produced in-process from the package's own Zod schemas — so a plain type, not a perimeter.
 */
type JsonSchemaNode = {
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

const MAX_HEADING_DEPTH = 6;

/** a table cell: pipes and line breaks would otherwise end the cell or the row */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

function code(value: unknown): string {
  return `\`${cell(JSON.stringify(value))}\``;
}

function variantsOf(node: JsonSchemaNode): readonly JsonSchemaNode[] | undefined {
  return node.oneOf ?? node.anyOf;
}

function hasOwnSection(node: JsonSchemaNode): boolean {
  if (variantsOf(node)) {
    return true;
  }
  if (node.type === 'array' && node.items) {
    return hasOwnSection(node.items);
  }
  return node.type === 'object' && node.properties !== undefined && Object.keys(node.properties).length > 0;
}

/** the type column: what an operator writes, in the words of the schema */
function describeType(node: JsonSchemaNode): string {
  if (node.const !== undefined) {
    return code(node.const);
  }
  if (node.enum) {
    return node.enum.map(code).join(' \\| ');
  }
  if (variantsOf(node)) {
    return 'one of (see below)';
  }
  if (node.type === 'array') {
    return node.items ? `array of ${describeType(node.items)}` : 'array';
  }
  if (typeof node.type === 'string') {
    return node.type;
  }
  return node.type ? node.type.join(' \\| ') : 'any';
}

function describeDefault(node: JsonSchemaNode, required: boolean): string {
  if (node.default !== undefined) {
    return code(node.default);
  }
  return required ? '_required_' : '';
}

function describeDescription(node: JsonSchemaNode): string {
  const own = node.description ?? '';
  const item = node.type === 'array' ? node.items?.description : undefined;
  return cell(item ? `${own} Each item: ${item}`.trim() : own);
}

function renderTable(node: JsonSchemaNode): string[] {
  const required = new Set(node.required ?? []);
  const rows = Object.entries(node.properties ?? {}).map(
    ([name, property]) =>
      `| \`${name}\` | ${describeType(property)} | ${describeDefault(property, required.has(name))} | ${describeDescription(property)} |`
  );
  return ['| Field | Type | Default | Description |', '| --- | --- | --- | --- |', ...rows];
}

function variantTitle(variant: JsonSchemaNode, index: number): string {
  const discriminant = Object.entries(variant.properties ?? {}).find(([, property]) => property.const !== undefined);
  return discriminant ? `\`${discriminant[0]}: ${JSON.stringify(discriminant[1].const)}\`` : `Variant ${index + 1}`;
}

function renderNode(node: JsonSchemaNode, path: string, depth: number): string[] {
  const heading = '#'.repeat(Math.min(depth, MAX_HEADING_DEPTH));
  const lines: string[] = [];
  const variants = variantsOf(node);
  if (variants) {
    variants.forEach((variant, index) => {
      lines.push(`${heading} ${path} — ${variantTitle(variant, index)}`, '');
      if (variant.description) {
        lines.push(variant.description, '');
      }
      lines.push(...renderSections(variant, path, depth + 1));
    });
    return lines;
  }
  if (node.type === 'array' && node.items) {
    return renderNode(node.items, `${path}[]`, depth);
  }
  lines.push(`${heading} ${path}`, '');
  if (node.description) {
    lines.push(node.description, '');
  }
  lines.push(...renderSections(node, path, depth + 1));
  return lines;
}

/** an object's table, then one section per property that holds structure of its own */
function renderSections(node: JsonSchemaNode, path: string, depth: number): string[] {
  const lines: string[] = [];
  if (node.properties && Object.keys(node.properties).length > 0) {
    lines.push(...renderTable(node), '');
  }
  if (node.additionalProperties !== undefined && node.additionalProperties !== false) {
    lines.push('Further keys are accepted here beyond those listed.', '');
  }
  for (const [name, property] of Object.entries(node.properties ?? {})) {
    if (hasOwnSection(property)) {
      lines.push(...renderNode(property, path ? `${path}.${name}` : name, depth));
    }
  }
  return lines;
}

/**
 * A reference page body: the root object's table, then a section per structured field, headed by
 * its dotted path (`app.debounce`, `agents[].model`). Plain markdown, so it runs through the same
 * pipeline as a written page and is indexed by search like one.
 */
export function renderJsonSchemaMarkdown(schema: JsonSchemaNode): string {
  return renderSections(schema, '', 2).join('\n').trim().concat('\n');
}

export type { JsonSchemaNode };
