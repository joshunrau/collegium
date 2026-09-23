import { Injectable } from '@nestjs/common';

import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import { TurnsService } from '@/turns/turns.service.ts';
import type { Turn } from '@/turns/turns.types.ts';

import type { TraceInput } from '../handlers/trace.utils.ts';

/** §8.3 — a turn's trace as /collegium trace renders it: its events, and any person it is parked on (§8.1) */
@Injectable()
export class TraceReportService {
  constructor(
    private readonly dateFormatter: DateFormatter,
    private readonly pendingDecisionsService: PendingDecisionsService,
    private readonly turnsService: TurnsService
  ) {}

  async read(turn: Turn): Promise<TraceInput> {
    const [events, pending] = await Promise.all([
      this.turnsService.listEvents(turn.id),
      this.pendingDecisionsService.listPending({ turnId: turn.id })
    ]);
    const formatDate = (date: Date) => this.dateFormatter.format(date);
    const parked = pending.map((decision) => ({ decision, since: formatDate(decision.requestedAt) }));
    return { events, formatDate, now: new Date(), parked, turn };
  }
}
