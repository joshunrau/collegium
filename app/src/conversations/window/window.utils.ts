import type { WindowEntry } from '../conversations.types.ts';

const CHARS_PER_TOKEN = 4;

export type PagedSource<TRow> = {
  /** drops the row `peek` last returned */
  advance(): void;
  /** the next row not yet advanced past, reading the next page when the buffer runs dry */
  peek(): Promise<TRow | undefined>;
};

/** the seam a real tokenizer could replace later. Never zero, so a window entry always has a cost */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

/** what an entry costs against the window budget: what the model will read, so a replayed result costs its replay line */
export function entryText(entry: WindowEntry): string {
  if (entry.kind === 'post') {
    return entry.post.message;
  }
  const { payload } = entry.event;
  return payload.kind === 'tool_result' && payload.replay !== undefined ? payload.replay : JSON.stringify(payload);
}

export function costOf(entries: readonly WindowEntry[]): number {
  return entries.reduce((sum, entry) => sum + estimateTokens(entryText(entry)), 0);
}

/** the instant an entry is ordered and anchored by: the post's own clock, or the host's for a trace event */
export function instantOf(entry: WindowEntry): Date {
  return entry.kind === 'post' ? entry.post.createdAt : entry.event.createdAt;
}

/**
 * Rows read newest-first a page at a time, by offset. A row that lands during the walk shifts the
 * pages beneath it, so one already taken can come back at the head of the next page; the walk
 * skips what it has seen rather than count it twice.
 */
export function createPagedSource<TRow extends { readonly id: string }>(
  read: (skip: number) => Promise<TRow[]>,
  pageSize: number
): PagedSource<TRow> {
  const buffer: TRow[] = [];
  const seen = new Set<string>();
  let fetched = 0;
  let drained = false;
  return {
    advance: () => {
      buffer.shift();
    },
    peek: async () => {
      while (buffer.length === 0 && !drained) {
        const rows = await read(fetched);
        fetched += rows.length;
        drained = rows.length < pageSize;
        for (const row of rows) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            buffer.push(row);
          }
        }
      }
      return buffer[0];
    }
  };
}
