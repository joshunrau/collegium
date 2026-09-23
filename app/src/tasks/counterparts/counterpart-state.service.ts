import { Injectable } from '@nestjs/common';

import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model } from '@/prisma/prisma.types.ts';

import { awaitsVerdictOnReport } from '../tasks.utils.ts';

import type { CounterpartState, OpenUnitState, WorkUnit } from '../tasks.types.ts';

type OpenUnitParties = Pick<WorkUnit, 'assigneeUsername' | 'channelId' | 'creatorUsername' | 'updatedAt'> & {
  readonly state: OpenUnitState;
};

/**
 * §3.15 — where the other party to an open unit stands, read when it is shown: the lane it holds
 * here (§5.1) and any person that turn waits on (§3.7, §3.7a), else how its latest turn here since
 * the unit last changed ended. It describes the party the unit now waits on, which may be the reader.
 */
@Injectable()
export class CounterpartStateService {
  constructor(
    private readonly channelLockService: ChannelLockService,
    private readonly pendingDecisionsService: PendingDecisionsService,
    @InjectModel('Turn') private readonly turns: Model<'Turn'>
  ) {}

  async readFor(unit: OpenUnitParties, readerUsername: string): Promise<CounterpartState> {
    const awaited = awaitsVerdictOnReport(unit.state) ? 'verdict' : 'report';
    const moverUsername = awaited === 'verdict' ? unit.creatorUsername : unit.assigneeUsername;
    if (moverUsername === readerUsername) {
      return { awaited, kind: 'awaiting-reader', since: unit.updatedAt };
    }
    const heldSince = this.channelLockService.heldSince(moverUsername, unit.channelId);
    if (heldSince !== undefined) {
      const [earliest] = await this.pendingDecisionsService.listPending({
        agentUsername: moverUsername,
        channelId: unit.channelId
      });
      return {
        awaited,
        beganBeforeChange: heldSince.getTime() <= unit.updatedAt.getTime(),
        kind: 'in-turn',
        since: heldSince,
        waitingOn: earliest && { on: earliest.kind, since: earliest.requestedAt }
      };
    }
    const latest = await this.turns.findFirst({
      orderBy: { startedAt: 'desc' },
      select: { endedAt: true },
      where: {
        agentUsername: moverUsername,
        channelId: unit.channelId,
        endedAt: { not: null },
        startedAt: { gt: unit.updatedAt }
      }
    });
    return latest?.endedAt ? { awaited, endedAt: latest.endedAt, kind: 'turn-ended' } : { awaited, kind: 'no-turn' };
  }
}
