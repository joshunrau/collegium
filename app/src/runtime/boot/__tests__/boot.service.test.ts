import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActivationService } from '@/activation/activation.service.ts';
import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { BackfillService } from '@/conversations/backfill/backfill.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { StatusPostService } from '@/turns/status/status-post.service.ts';
import { TurnsService } from '@/turns/turns.service.ts';
import type { AbandonedStatusPost } from '@/turns/turns.types.ts';

import { LivenessService } from '../../liveness/liveness.service.ts';
import { BootService } from '../boot.service.ts';

const STATUS_POST: AbandonedStatusPost = { agentUsername: 'mira', channelId: 'channel-1', postId: 'status-1' };

describe('BootService', () => {
  let bootService: BootService;
  let calls: string[];
  let livenessService: MockedInstance<LivenessService>;
  let rosterService: MockedInstance<RosterService>;
  let statusPostService: MockedInstance<StatusPostService>;
  let turnsService: MockedInstance<TurnsService>;

  beforeEach(async () => {
    calls = [];
    const activationService = MockFactory.createMock(ActivationService);
    activationService.sweep.mockImplementation(() => {
      calls.push('sweep');
      return Promise.resolve();
    });
    const pendingDecisionsService = MockFactory.createMock(PendingDecisionsService);
    pendingDecisionsService.invalidateAll.mockImplementation(() => {
      calls.push('invalidate');
      return Promise.resolve();
    });
    const backfillService = MockFactory.createMock(BackfillService);
    backfillService.run.mockImplementation(() => {
      calls.push('backfill');
      return Promise.resolve();
    });
    livenessService = MockFactory.createMock(LivenessService);
    livenessService.readDowntime.mockResolvedValue(undefined);
    livenessService.startStamping.mockResolvedValue(undefined);
    rosterService = MockFactory.createMock(RosterService);
    rosterService.reconcile.mockImplementation(() => {
      calls.push('reconcile');
      return Promise.resolve(Result.ok());
    });
    statusPostService = MockFactory.createMock(StatusPostService);
    statusPostService.closeAbandoned.mockImplementation(() => {
      calls.push('close');
      return Promise.resolve();
    });
    turnsService = MockFactory.createMock(TurnsService);
    turnsService.abandonRunning.mockImplementation(() => {
      calls.push('abandon');
      return Promise.resolve({ count: 3, statusPosts: [STATUS_POST] });
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        BootService,
        MockFactory.createForService(LoggingService),
        { provide: ActivationService, useValue: activationService },
        { provide: PendingDecisionsService, useValue: pendingDecisionsService },
        { provide: BackfillService, useValue: backfillService },
        { provide: LivenessService, useValue: livenessService },
        { provide: RosterService, useValue: rosterService },
        { provide: StatusPostService, useValue: statusPostService },
        { provide: TurnsService, useValue: turnsService }
      ]
    }).compile();
    bootService = moduleRef.get(BootService);
  });

  it('should abandon turns, close their status posts, invalidate prompts, backfill, and reconcile — in that order', async () => {
    const report = await bootService.run();
    expect(calls).toStrictEqual(['abandon', 'close', 'invalidate', 'backfill', 'reconcile', 'sweep']);
    expect(report).toStrictEqual({ abandonedTurns: 3, downtime: undefined });
  });

  it('should report the downtime the process recorded (§7.3)', async () => {
    const downtime = { kind: 'clean', startedAt: new Date(2000), stoppedAt: new Date(1000) } as const;
    livenessService.readDowntime.mockResolvedValue(downtime);
    expect((await bootService.run()).downtime).toStrictEqual(downtime);
  });

  it('should read the downtime before the stamp that overwrites it', async () => {
    livenessService.startStamping.mockImplementation(() => {
      expect(livenessService.readDowntime).toHaveBeenCalledOnce();
      return Promise.resolve();
    });
    await bootService.run();
    expect(livenessService.startStamping).toHaveBeenCalledOnce();
  });

  it('should close the status post of every abandoned turn that opened one', async () => {
    await bootService.run();
    expect(statusPostService.closeAbandoned).toHaveBeenCalledExactlyOnceWith(STATUS_POST);
  });

  it('should close at most the fifty most recently started abandoned status posts', async () => {
    const statusPosts = Array.from({ length: 60 }, (_, index) => ({ ...STATUS_POST, postId: `status-${index}` }));
    turnsService.abandonRunning.mockResolvedValue({ count: 60, statusPosts });
    await bootService.run();
    expect(statusPostService.closeAbandoned).toHaveBeenCalledTimes(50);
    expect(statusPostService.closeAbandoned).toHaveBeenLastCalledWith(statusPosts[49]);
  });

  it('should refuse to boot when the roster cannot be reconciled', async () => {
    rosterService.reconcile.mockResolvedValue(Result.err({ kind: 'api', message: 'gateway down' }));
    await expect(bootService.run()).rejects.toThrow('failed to reconcile channel membership: gateway down');
  });
});
