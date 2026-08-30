/** one conventional module as the synthetic entry re-exports it: a namespace whose `default` is the contribution */
type SyntheticModule = {
  readonly default?: unknown;
  readonly [key: string]: unknown;
};

export type SyntheticEntry = {
  readonly config: SyntheticModule;
  readonly tools: { readonly [name: string]: SyntheticModule };
};

/** the shape the synthetic entry exports; a mismatch is the framework's own bug, so it throws */
export function assertSyntheticEntry(defaultExport: unknown): asserts defaultExport is SyntheticEntry {
  if (typeof defaultExport !== 'object' || defaultExport === null) {
    throw new Error('the synthetic entry did not export its module record');
  }
}
