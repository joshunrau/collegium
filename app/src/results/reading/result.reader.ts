import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model } from '@/prisma/prisma.types.ts';

import type { RecordedResult } from '../results.types.ts';

/** how many of a turn's newest events the unknown-reference refusal looks through for the references it names */
const RECENT_EVENT_ROWS = 50;

/**
 * §3.8 — a turn's results, read back from the events that recorded them whole. A reference is its
 * result's event sequence, and every read is keyed on the calling turn's own id, so another turn's
 * reference resolves to nothing: turn-scoped by construction, with no copy held and nothing to expire.
 * It never writes; the turn service stays the events' only writer.
 */
@Injectable()
export class ResultReader {
  constructor(@InjectModel('TurnEvent') private readonly events: Model<'TurnEvent'>) {}

  /** the newest references this turn's results were shown under, newest first */
  async listRefs(turnId: string, take: number): Promise<string[]> {
    const rows = await this.events.findMany({
      orderBy: { sequence: 'desc' },
      select: { payload: true, sequence: true },
      take: RECENT_EVENT_ROWS,
      where: { kind: 'tool_result', turnId }
    });
    return rows
      .filter(({ payload }) => payload.kind === 'tool_result' && payload.presentedAs?.viewChars !== undefined)
      .slice(0, take)
      .map(({ sequence }) => `r${sequence}`);
  }

  /** one result of the turn by its event's sequence; nothing for another turn's, or for an event that records no result */
  async read(turnId: string, sequence: number): Promise<RecordedResult | undefined> {
    const row = await this.events.findUnique({
      select: { createdAt: true, payload: true },
      where: { turnId_sequence: { sequence, turnId } }
    });
    if (row?.payload.kind !== 'tool_result') {
      return undefined;
    }
    return { output: row.payload.output, recordedAt: row.createdAt, viewChars: row.payload.presentedAs?.viewChars };
  }
}
