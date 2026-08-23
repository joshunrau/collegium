import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActivationService } from '@/activation/activation.service.ts';
import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { BackfillService } from '@/conversations/backfill/backfill.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { TurnsService } from '@/turns/turns.service.ts';

import { BootService } from '../boot.service.ts';

describe('BootService', () => {
  let bootService: BootService;
  let calls: string[];
  let rosterService: MockedInstance<RosterService>;

  beforeEach(async () => {
    calls = [];
    const activationService = MockFactory.createMock(ActivationService);
    activationService.sweep.mockImplementation(() => {
      calls.push('sweep');
      return Promise.resolve();
    });
    const approvalsService = MockFactory.createMock(ApprovalsService);
    approvalsService.invalidateAll.mockImplementation(() => {
      calls.push('invalidate');
      return Promise.resolve(2);
    });
    const backfillService = MockFactory.createMock(BackfillService);
    backfillService.run.mockImplementation(() => {
      calls.push('backfill');
      return Promise.resolve();
    });
    const conversationsService = MockFactory.createMock(ConversationsService);
    conversationsService.latestObservedAt.mockResolvedValue(new Date(1000));
    rosterService = MockFactory.createMock(RosterService);
    rosterService.reconcile.mockImplementation(() => {
      calls.push('reconcile');
      return Promise.resolve(Result.ok());
    });
    const turnsService = MockFactory.createMock(TurnsService);
    turnsService.abandonRunning.mockImplementation(() => {
      calls.push('abandon');
      return Promise.resolve(3);
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        BootService,
        { provide: ActivationService, useValue: activationService },
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: BackfillService, useValue: backfillService },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: RosterService, useValue: rosterService },
        { provide: TurnsService, useValue: turnsService }
      ]
    }).compile();
    bootService = moduleRef.get(BootService);
  });

  it('should abandon turns, invalidate prompts, backfill, and reconcile — in that order', async () => {
    const report = await bootService.run();
    expect(calls).toStrictEqual(['abandon', 'invalidate', 'backfill', 'reconcile', 'sweep']);
    expect(report).toStrictEqual({ abandonedTurns: 3, downSince: new Date(1000) });
  });

  it('should refuse to boot when the roster cannot be reconciled', async () => {
    rosterService.reconcile.mockResolvedValue(Result.err({ kind: 'api', message: 'gateway down' }));
    await expect(bootService.run()).rejects.toThrow('failed to reconcile channel membership: gateway down');
  });
});
