import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActivationService } from '@/activation/activation.service.ts';
import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { BackfillService } from '@/conversations/backfill/backfill.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { PluginsRegistry } from '@/plugins/plugins.registry.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import type { WorkUnit } from '@/tasks/tasks.types.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';
import { StatusPostService } from '@/turns/status/status-post.service.ts';
import { TurnsService } from '@/turns/turns.service.ts';
import type { AbandonedStatusPost, AbandonedTurn, ActedTurn, UnactedTurn } from '@/turns/turns.types.ts';

import { LivenessService } from '../../liveness/liveness.service.ts';
import { BootService } from '../boot.service.ts';

const STATUS_POST: AbandonedStatusPost = { agentUsername: 'mira', channelId: 'channel-1', postId: 'status-1' };

const UNACTED: UnactedTurn = { agentUsername: 'owen', channelId: 'channel-2', triggeringPostId: 'post-1' };

const ACTED: ActedTurn = { agentUsername: 'mira', channelId: 'channel-1', triggeringPostId: 'post-2' };

const ABANDONED: AbandonedTurn[] = ['turn-1', 'turn-2', 'turn-3'].map((turnId) => ({
  agentUsername: 'mira',
  channelId: 'channel-1',
  turnId
}));

describe('BootService', () => {
  let activationService: MockedInstance<ActivationService>;
  let bootService: BootService;
  let calls: string[];
  let livenessService: MockedInstance<LivenessService>;
  let loggingService: MockedInstance<LoggingService>;
  let rosterService: MockedInstance<RosterService>;
  let statusPostService: MockedInstance<StatusPostService>;
  let tasksService: MockedInstance<TasksService>;
  let toolRegistry: MockedInstance<ToolRegistry>;
  let turnsService: MockedInstance<TurnsService>;

  beforeEach(async () => {
    calls = [];
    activationService = MockFactory.createMock(ActivationService);
    activationService.requeueUnacted.mockImplementation(() => {
      calls.push('requeue');
      return Promise.resolve(1);
    });
    activationService.requeueHeld.mockImplementation(() => {
      calls.push('requeue-held');
      return Promise.resolve(2);
    });
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
    tasksService = MockFactory.createMock(TasksService);
    tasksService.findWorkedUnit.mockResolvedValue(undefined);
    toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.listUngrantedIn.mockReturnValue([]);
    turnsService = MockFactory.createMock(TurnsService);
    turnsService.abandonRunning.mockImplementation(() => {
      calls.push('abandon');
      return Promise.resolve({ acted: [ACTED], statusPosts: [STATUS_POST], turns: ABANDONED, unacted: [UNACTED] });
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
        { provide: PluginsRegistry, useValue: { toolsets: [{ name: 'bookmark', tools: {} }] } },
        { provide: StatusPostService, useValue: statusPostService },
        { provide: TasksService, useValue: tasksService },
        { provide: ToolRegistry, useValue: toolRegistry },
        { provide: TurnsService, useValue: turnsService }
      ]
    }).compile();
    bootService = moduleRef.get(BootService);
    loggingService = moduleRef.get(LoggingService);
  });

  it('should warn, and still boot, naming each plugin tool no agent is granted (§3.14)', async () => {
    toolRegistry.listUngrantedIn.mockReturnValue([
      ['bookmark', 'save'],
      ['bookmark', 'list']
    ]);
    await bootService.run();
    expect(toolRegistry.listUngrantedIn).toHaveBeenCalledWith(new Set(['bookmark']));
    expect(loggingService.warn).toHaveBeenCalledWith(expect.stringContaining('bookmark::save, bookmark::list'));
  });

  it('should warn of nothing when every plugin tool is granted', async () => {
    await bootService.run();
    expect(loggingService.warn).not.toHaveBeenCalled();
  });

  it('should abandon turns, close their status posts, queue the unacted again, invalidate prompts, backfill, reconcile, and queue held posts — in that order', async () => {
    const report = await bootService.run();
    expect(calls).toStrictEqual([
      'abandon',
      'close',
      'requeue',
      'invalidate',
      'backfill',
      'reconcile',
      'requeue-held',
      'sweep'
    ]);
    expect(report).toStrictEqual({
      abandonedTurns: 3,
      downtime: undefined,
      requeuedHandoffs: 2,
      requeuedTurns: 1,
      strandedUnits: []
    });
  });

  it('should hand activation the abandoned turns that had not acted (§7.3)', async () => {
    await bootService.run();
    expect(activationService.requeueUnacted).toHaveBeenCalledExactlyOnceWith([UNACTED]);
  });

  it('should hand activation every abandoned turn, whose held posts it queues once the roster reconciles (§5.2, §7.3)', async () => {
    await bootService.run();
    expect(activationService.requeueHeld).toHaveBeenCalledExactlyOnceWith(ABANDONED);
  });

  it('should report the unit each acted abandoned turn was working, for the boot notice to name (§7.3)', async () => {
    tasksService.findWorkedUnit.mockResolvedValue({
      assigneeUsername: 'mira',
      channelId: 'channel-1',
      creatorUsername: 'owen',
      id: 'ab12cd34ef56'
    } as WorkUnit);
    const report = await bootService.run();
    expect(tasksService.findWorkedUnit).toHaveBeenCalledExactlyOnceWith(ACTED);
    expect(report.strandedUnits).toStrictEqual([
      { assigneeUsername: 'mira', channelId: 'channel-1', creatorUsername: 'owen', reference: 'ab12cd34' }
    ]);
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
    turnsService.abandonRunning.mockResolvedValue({ acted: [], statusPosts, turns: [], unacted: [] });
    await bootService.run();
    expect(statusPostService.closeAbandoned).toHaveBeenCalledTimes(50);
    expect(statusPostService.closeAbandoned).toHaveBeenLastCalledWith(statusPosts[49]);
  });

  it('should refuse to boot when the roster cannot be reconciled', async () => {
    rosterService.reconcile.mockResolvedValue(Result.err({ kind: 'api', message: 'gateway down' }));
    await expect(bootService.run()).rejects.toThrow('failed to reconcile channel membership: gateway down');
  });
});
