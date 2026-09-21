import { estimateTokens } from '@collegium/core/utils';

import { renderRecordedToolName } from '@/utils/tool-name.utils.ts';

import { renderPostWithAttachments, replayTextOf } from '../conversations.utils.ts';

import type { WindowEntry } from '../conversations.types.ts';

export type PagedSource<TRow> = {
  /** drops the row `peek` last returned */
  advance(): void;
  /** the next row not yet advanced past, reading the next page when the buffer runs dry */
  peek(): Promise<TRow | undefined>;
};

/** what an entry costs against the window budget: what the model will read, so a replayed result costs its replay line */
export function entryText(entry: WindowEntry): string {
  if (entry.kind === 'post') {
    return renderPostWithAttachments(entry.post);
  }
  const { payload } = entry.event;
  return replayTextOf(payload) ?? JSON.stringify(payload);
}

/**
 * §3.8 — how one earlier action reads: the line the tool declared, else its bare name. Not
 * `entryText`'s rule, which falls back to the whole payload because that is what a result with no
 * replay line costs the window; an earlier action is one line or it is nothing.
 */
export function replayLineOf(payload: PrismaJson.TurnEventPayload): string | undefined {
  if (payload.kind !== 'tool_result') {
    return undefined;
  }
  return replayTextOf(payload) ?? `[${renderRecordedToolName(payload.toolName)}]`;
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
