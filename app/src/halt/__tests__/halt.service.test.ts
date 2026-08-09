import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { NotificationsService } from '@/notifications/notifications.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { HaltService } from '../halt.service.ts';

describe('HaltService', () => {
  let approvalsService: MockedInstance<ApprovalsService>;
  let haltService: HaltService;
  let notificationsService: MockedInstance<NotificationsService>;
  let rosterService: MockedInstance<RosterService>;

  beforeEach(async () => {
    approvalsService = MockFactory.createMock(ApprovalsService);
    approvalsService.invalidateAll.mockResolvedValue(0);
    const configService = MockFactory.createMock(ConfigService);
    configService.get.mockReturnValue(3);
    notificationsService = MockFactory.createMock(NotificationsService);
    notificationsService.notify.mockResolvedValue(undefined);
    rosterService = MockFactory.createMock(RosterService);
    rosterService.findRespondToAllViolation.mockReturnValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        HaltService,
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: ConfigService, useValue: configService },
        MockFactory.createForService(LoggingService),
        { provide: NotificationsService, useValue: notificationsService },
        { provide: RosterService, useValue: rosterService }
      ]
    }).compile();
    haltService = moduleRef.get(HaltService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start unhalted — a halt never survives a restart', () => {
    expect(haltService.isHalted()).toBe(false);
  });

  it('should halt every agent at the turn past the hourly ceiling, invalidating pending approvals', async () => {
    expect(await haltService.admitTurnStart()).toBe(true);
    expect(await haltService.admitTurnStart()).toBe(true);
    expect(await haltService.admitTurnStart()).toBe(true);
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
    await haltService.admitTurnStart();
    await haltService.admitTurnStart();
    await haltService.admitTurnStart();
    vi.advanceTimersByTime(61 * 60 * 1000);
    expect(await haltService.admitTurnStart()).toBe(true);
    expect(haltService.isHalted()).toBe(false);
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
    expect(haltService.resume('casey').error).toStrictEqual({ channelId: 'channel-1', kind: 'violation-standing' });
    rosterService.findRespondToAllViolation.mockReturnValue(undefined);
    expect(haltService.resume('casey').success).toBe(true);
    expect(haltService.isHalted()).toBe(false);
  });

  it('should refuse resume when nothing is halted', () => {
    expect(haltService.resume('casey').error).toStrictEqual({ kind: 'not-halted' });
  });
});
