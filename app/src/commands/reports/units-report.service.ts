import { Injectable } from '@nestjs/common';

import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import { TasksService } from '@/tasks/tasks.service.ts';

import { listUnitParties } from '../handlers/units.utils.ts';

import type { UnitsReport } from '../handlers/units.utils.ts';

/** §8.4 — an agent's open units in a channel as /collegium units lists them, and each party to them parked on a person */
@Injectable()
export class UnitsReportService {
  constructor(
    private readonly dateFormatter: DateFormatter,
    private readonly pendingDecisionsService: PendingDecisionsService,
    private readonly tasksService: TasksService
  ) {}

  async read(agentUsername: string, channelId: string): Promise<UnitsReport> {
    const [units, pending] = await Promise.all([
      this.tasksService.listOpenFor({ agentUsername, channelId }),
      this.pendingDecisionsService.listPending({ channelId })
    ]);
    const parties = listUnitParties(agentUsername, units);
    const parked = pending
      .filter((decision) => parties.has(decision.agentUsername))
      .map((decision) => ({ decision, since: this.dateFormatter.format(decision.requestedAt) }));
    return { parked, units };
  }
}
