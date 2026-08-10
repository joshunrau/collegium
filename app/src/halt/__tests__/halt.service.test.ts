import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { NotificationsService } from '@/notifications/notifications.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';
import type { ModelTable } from '@/testing/factories/model-table.factory.ts';
import { TurnsService } from '@/turns/turns.service.ts';

import { HaltService } from '../halt.service.ts';

type WatermarkRow = { key: string; resumedAt: Date };

describe('HaltService', () => {
  let approvalsService: MockedInstance<ApprovalsService>;
  let haltService: HaltService;
  let notificationsService: MockedInstance<NotificationsService>;
  let rosterService: MockedInstance<RosterService>;
  /** the durable window, as start times: what the Turn table would hold */
  let startedAt: Date[];
  let turnsService: MockedInstance<TurnsService>;
  let watermarks: ModelTable<WatermarkRow>;

  const createService = async (): Promise<HaltService> => {
    const configService = MockFactory.createMock(ConfigService);
    configService.get.mockReturnValue(3);
    const moduleRef = await Test.createTestingModule({
      providers: [
        HaltService,
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: ConfigService, useValue: configService },
        MockFactory.createForService(LoggingService),
        { provide: NotificationsService, useValue: notificationsService },
        { provide: RosterService, useValue: rosterService },
        { provide: TurnsService, useValue: turnsService },
        { provide: getModelToken('ResumeWatermark'), useValue: watermarks }
      ]
    }).compile();
    return moduleRef.get(HaltService);
  };

  /** what a turn start does to the store, since the ceiling counts rows rather than calls */
  const startTurn = (): void => {
    startedAt.push(new Date());
  };

  beforeEach(async () => {
    approvalsService = MockFactory.createMock(ApprovalsService);
    approvalsService.invalidateAll.mockResolvedValue(0);
    notificationsService = MockFactory.createMock(NotificationsService);
    notificationsService.notify.mockResolvedValue(undefined);
    rosterService = MockFactory.createMock(RosterService);
    rosterService.findRespondToAllViolation.mockReturnValue(undefined);
    startedAt = [];
    turnsService = MockFactory.createMock(TurnsService);
    turnsService.countStartedAfter.mockImplementation((moment: Date) =>
      Promise.resolve(startedAt.filter((at) => at > moment).length)
    );
    watermarks = createModelTable<WatermarkRow>();
    haltService = await createService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start unhalted — a halt never survives a restart', () => {
    expect(haltService.isHalted()).toBe(false);
  });

  it('should halt every agent at the turn past the hourly ceiling, invalidating pending approvals', async () => {
    for (let admitted = 0; admitted < 3; admitted++) {
      expect(await haltService.admitTurnStart()).toBe(true);
      startTurn();
    }
    expect(await haltService.admitTurnStart()).toBe(false);
    expect(haltService.isHalted()).toBe(true);
    expect(notificationsService.notify).toHaveBeenCalledWith({
      kind: 'halt',
      reason: { ceiling: 3, kind: 'turn-ceiling' }
    });
    expect(approvalsService.invalidateAll).toHaveBeenCalledWith('halt');
  });

  it('should free ceiling slots as turn starts age out of the rolling hour', async () => {
    vi.useFakeTimers();
    for (let admitted = 0; admitted < 3; admitted++) {
      startTurn();
    }
    vi.advanceTimersByTime(61 * 60 * 1000);
    expect(await haltService.admitTurnStart()).toBe(true);
    expect(haltService.isHalted()).toBe(false);
  });

  // §7.4 — otherwise a crash-looping instance grants itself a fresh allowance every boot
  it('should re-evaluate a full window at the first turn start after a restart', async () => {
    for (let admitted = 0; admitted < 3; admitted++) {
      startTurn();
    }
    const rebooted = await createService();
    expect(await rebooted.admitTurnStart()).toBe(false);
    expect(rebooted.isHalted()).toBe(true);
  });

  it('should refuse every turn start while the halt stands', async () => {
    await haltService.halt({ ceiling: 3, kind: 'turn-ceiling' });
    expect(await haltService.admitTurnStart()).toBe(false);
  });

  it('should leave the first reason standing when a second halt is raised', async () => {
    await haltService.halt({ ceiling: 3, kind: 'turn-ceiling' });
    await haltService.halt({ agentUsernames: ['mira', 'owen'], channelId: 'channel-1', kind: 'topology-violation' });
    expect(notificationsService.notify).toHaveBeenCalledTimes(1);
    expect(notificationsService.notify).toHaveBeenCalledWith({
      kind: 'halt',
      reason: { ceiling: 3, kind: 'turn-ceiling' }
    });
    expect(approvalsService.invalidateAll).toHaveBeenCalledTimes(1);
  });

  it('should refuse resume while the violation that raised the halt still stands', async () => {
    const violation = { agentUsernames: ['mira', 'owen'], channelId: 'channel-1' };
    await haltService.halt({ ...violation, kind: 'topology-violation' });
    rosterService.findRespondToAllViolation.mockReturnValue(violation);
    expect((await haltService.resume('casey')).error).toStrictEqual({
      channelId: 'channel-1',
      kind: 'violation-standing'
    });
    rosterService.findRespondToAllViolation.mockReturnValue(undefined);
    expect((await haltService.resume('casey')).success).toBe(true);
    expect(haltService.isHalted()).toBe(false);
  });

  it('should refuse resume when nothing is halted', async () => {
    expect((await haltService.resume('casey')).error).toStrictEqual({ kind: 'not-halted' });
  });

  // the human's authority is the control §7.4 routes to, and the reset must outlive the restart
  it('should start a fresh allowance from a resume that a restart then follows', async () => {
    for (let admitted = 0; admitted < 3; admitted++) {
      startTurn();
    }
    await haltService.halt({ ceiling: 3, kind: 'turn-ceiling' });
    expect((await haltService.resume('casey')).success).toBe(true);
    const rebooted = await createService();
    expect(await rebooted.admitTurnStart()).toBe(true);
  });
});
