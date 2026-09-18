import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoggingService } from '@/logging/logging.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';
import type { Trigger } from '@/triggers/triggers.types.ts';

import { SchedulesRegistry } from '../schedules.registry.ts';
import { SchedulesService } from '../schedules.service.ts';

import type { ScheduleRuntime } from '../schedules.types.ts';

type StateRow = {
  firstSeenAt: Date;
  id: string;
  lastFiredFor?: Date | null;
};

const SWEEP: ScheduleRuntime = {
  agentUsername: 'mira',
  channel: 'ops',
  channelId: 'channel-ops',
  handle: 'morning-sweep',
  id: 'mira:morning-sweep',
  prompt: 'Sweep the shared mailbox.',
  recurrence: { at: '09:00', every: 'day' },
  timezone: 'UTC'
};

/** the occurrence 2026-09-16T09:00Z has passed, and the mark sits the day before it */
const BEFORE_OCCURRENCE = new Date('2026-09-15T12:00:00Z');

describe('SchedulesService', () => {
  let loggingService: MockedInstance<LoggingService>;
  let rows: StateRow[];
  let schedules: ScheduleRuntime[];
  let schedulesService: SchedulesService;
  let triggersService: MockedInstance<TriggersService>;

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date('2026-09-16T12:00:00Z') });
    schedules = [SWEEP];
    loggingService = MockFactory.createMock(LoggingService);
    triggersService = MockFactory.createMock(TriggersService);
    triggersService.record.mockResolvedValue(Result.ok({ id: 'trigger-1' } as Trigger));
    triggersService.resolveSupersededBy.mockResolvedValue(undefined);
    const schedulesRegistry = MockFactory.createMock(SchedulesRegistry);
    schedulesRegistry.list.mockImplementation(() => schedules);
    const table = createModelTable<StateRow>({ defaults: () => ({ firstSeenAt: new Date() }) });
    rows = table.rows;
    const moduleRef = await Test.createTestingModule({
      providers: [
        SchedulesService,
        { provide: LoggingService, useValue: loggingService },
        { provide: SchedulesRegistry, useValue: schedulesRegistry },
        { provide: TriggersService, useValue: triggersService },
        { provide: getModelToken('ScheduleState'), useValue: table }
      ]
    }).compile();
    schedulesService = moduleRef.get(SchedulesService);
    await schedulesService.reconcile();
    rows[0]!.firstSeenAt = BEFORE_OCCURRENCE;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should record one trigger for a passed occurrence and advance the mark', async () => {
    await schedulesService.tickOnce();
    expect(triggersService.record).toHaveBeenCalledTimes(1);
    expect(triggersService.record.mock.calls[0]?.[0]).toMatchObject({
      dedupeKey: 'cron:mira:morning-sweep:2026-09-16T09:00:00.000Z',
      reference: { body: 'Sweep the shared mailbox.', id: 'morning-sweep' },
      source: 'cron',
      targetAgentUsername: 'mira',
      targetChannelId: 'channel-ops'
    });
    expect(rows[0]?.lastFiredFor).toStrictEqual(new Date('2026-09-16T09:00:00Z'));
  });

  it('should record nothing on a second tick inside the same occurrence', async () => {
    await schedulesService.tickOnce();
    await schedulesService.tickOnce();
    expect(triggersService.record).toHaveBeenCalledTimes(1);
  });

  it('should record one trigger for a week of missed occurrences (§4.2)', async () => {
    rows[0]!.firstSeenAt = new Date('2026-09-09T12:00:00Z');
    await schedulesService.tickOnce();
    expect(triggersService.record).toHaveBeenCalledTimes(1);
  });

  it('should close the schedule’s previous outstanding firing when the next is recorded (§4.2)', async () => {
    await schedulesService.tickOnce();
    expect(triggersService.resolveSupersededBy).toHaveBeenCalledWith({ id: 'trigger-1' }, 'cron:mira:morning-sweep:');
  });

  it('should leave the mark alone when the channel could not be reached', async () => {
    triggersService.record.mockResolvedValue(
      Result.err({ channelId: 'channel-ops', kind: 'channel-unreachable', message: 'mattermost is down' })
    );
    await schedulesService.tickOnce();
    expect(rows[0]?.lastFiredFor).toBeUndefined();
  });

  it('should advance past an occurrence no retry can announce, logging it once', async () => {
    triggersService.record.mockResolvedValue(
      Result.err({ agentUsername: 'mira', channelId: 'channel-ops', kind: 'agent-absent' })
    );
    await schedulesService.tickOnce();
    await schedulesService.tickOnce();
    expect(rows[0]?.lastFiredFor).toStrictEqual(new Date('2026-09-16T09:00:00Z'));
    expect(loggingService.error).toHaveBeenCalledTimes(1);
  });

  it('should keep state on the declared set alone', async () => {
    schedules = [];
    await schedulesService.reconcile();
    expect(rows).toHaveLength(0);
  });

  it('should give a newly declared schedule no past to announce', async () => {
    rows[0]!.firstSeenAt = new Date('2026-09-16T11:00:00Z');
    await schedulesService.tickOnce();
    expect(triggersService.record).not.toHaveBeenCalled();
  });

  it('should survive a schedule that throws and still tick the next', async () => {
    schedules = [{ ...SWEEP, id: 'mira:unreconciled' }, SWEEP];
    await schedulesService.tickOnce();
    expect(loggingService.error).toHaveBeenCalledTimes(1);
    expect(triggersService.record).toHaveBeenCalledTimes(1);
  });
});
