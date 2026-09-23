import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ApprovalsService } from '../../approvals.service.ts';
import { AsksService } from '../../asks.service.ts';
import { PendingDecisionsService } from '../pending-decisions.service.ts';

import type { PendingApproval } from '../../approvals.types.ts';
import type { PendingAsk } from '../../asks.types.ts';

const BASE = { agentUsername: 'mira', channelId: 'channel-1', promptPostId: 'prompt-1', turnId: 'turn-1' };

const APPROVAL: PendingApproval = {
  ...BASE,
  actionName: 'workspace::write',
  kind: 'approval',
  requestedAt: new Date('2026-09-22T10:00:00Z')
};

const ASK: PendingAsk = {
  ...BASE,
  actionName: 'ask::human',
  kind: 'ask',
  question: 'Which airport?',
  requestedAt: new Date('2026-09-22T09:00:00Z')
};

describe('PendingDecisionsService', () => {
  let approvalsService: MockedInstance<ApprovalsService>;
  let asksService: MockedInstance<AsksService>;
  let pendingDecisionsService: PendingDecisionsService;

  beforeEach(async () => {
    approvalsService = MockFactory.createMock(ApprovalsService);
    approvalsService.listPending.mockResolvedValue([APPROVAL]);
    asksService = MockFactory.createMock(AsksService);
    asksService.listPending.mockResolvedValue([ASK]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PendingDecisionsService,
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: AsksService, useValue: asksService }
      ]
    }).compile();
    pendingDecisionsService = moduleRef.get(PendingDecisionsService);
  });

  it('should list approvals and questions together, oldest first, in the scope asked for (§8.4)', async () => {
    expect(await pendingDecisionsService.listPending({ channelId: 'channel-1' })).toStrictEqual([ASK, APPROVAL]);
    expect(approvalsService.listPending).toHaveBeenCalledWith({ channelId: 'channel-1' });
    expect(asksService.listPending).toHaveBeenCalledWith({ channelId: 'channel-1' });
  });
});
