import { renderRecordedToolName } from '@/utils/tool-name.utils.ts';

import { replayTextOf } from '../conversations.utils.ts';

import type { WindowEntry } from '../conversations.types.ts';

/** the call an event answers or gates: its result, an approval or ask that names it; nothing for an event that stands alone */
function answeredCallIdOf(entry: WindowEntry): string | undefined {
  if (entry.kind === 'post') {
    return undefined;
  }
  const { payload } = entry.event;
  switch (payload.kind) {
    case 'approval_decided':
    case 'approval_requested':
    case 'ask_answered':
    case 'ask_requested':
    case 'tool_result':
      return payload.callId;
    case 'assistant_message':
    case 'output_rejected':
    case 'record_written':
    case 'steering_received':
      return undefined;
  }
}

export type PagedSource<TRow> = {
  /** drops the row `peek` last returned */
  advance(): void;
  /** the next row not yet advanced past, reading the next page when the buffer runs dry */
  peek(): Promise<TRow | undefined>;
};

export type UnitCollector = {
  /** fed the walk newest first: the unit this entry completes, or nothing while it waits for the call it answers */
  take(entry: WindowEntry): readonly WindowEntry[] | undefined;
};

/**
 * §3.8 — how one earlier action reads: the line its result replays as, else its bare name. Not the
 * window's rule, where a short result keeps its text; an earlier action is one line or it is nothing.
 */
export function replayLineOf(payload: PrismaJson.TurnEventPayload): string | undefined {
  if (payload.kind !== 'tool_result') {
    return undefined;
  }
  return replayTextOf(payload) ?? `[${renderRecordedToolName(payload.toolName)}]`;
}

/** the instant an entry is ordered and anchored by: the post's own clock, or the host's for a trace event */
export function instantOf(entry: WindowEntry): Date {
  return entry.kind === 'post' ? entry.post.createdAt : entry.event.createdAt;
}

/**
 * §3.8 — what the window admits whole, read newest first: an assistant message together with every
 * event answering its calls, which arrive before it, or any other entry alone. A call is rendered
 * beside its result, so costing either apart from the other would charge what is never sent.
 */
export function createUnitCollector(): UnitCollector {
  const answers = new Map<string, WindowEntry[]>();
  return {
    take: (entry) => {
      const callId = answeredCallIdOf(entry);
      if (callId !== undefined) {
        answers.set(callId, [...(answers.get(callId) ?? []), entry]);
        return undefined;
      }
      if (entry.kind === 'post' || entry.event.payload.kind !== 'assistant_message') {
        return [entry];
      }
      const answering = entry.event.payload.toolCalls.flatMap((call) => {
        const found = answers.get(call.callId) ?? [];
        answers.delete(call.callId);
        return found;
      });
      return [entry, ...answering];
    }
  };
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
