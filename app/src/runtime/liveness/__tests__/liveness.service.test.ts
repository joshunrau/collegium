import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoggingService } from '@/logging/logging.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';
import type { ModelTable } from '@/testing/factories/model-table.factory.ts';

import { LivenessService } from '../liveness.service.ts';

type RuntimeRow = { id: string; lastAliveAt: Date; stoppedAt: Date | null };

describe('LivenessService', () => {
  let livenessService: LivenessService;
  let runtime: ModelTable<RuntimeRow>;

  beforeEach(async () => {
    vi.useFakeTimers();
    runtime = createModelTable<RuntimeRow>();
    const moduleRef = await Test.createTestingModule({
      providers: [
        LivenessService,
        MockFactory.createForService(LoggingService),
        { provide: getModelToken('Runtime'), useValue: runtime }
      ]
    }).compile();
    livenessService = moduleRef.get(LivenessService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should stamp the process as alive before its first interval elapses', async () => {
    await livenessService.startStamping();
    expect(runtime.rows).toStrictEqual([{ id: 'process', lastAliveAt: new Date(), stoppedAt: null }]);
  });

  it('should advance the stamp on its interval', async () => {
    await livenessService.startStamping();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runtime.rows[0]?.lastAliveAt).toStrictEqual(new Date());
  });

  it('should record a stop time on a clean shutdown', async () => {
    await livenessService.startStamping();
    await livenessService.beforeApplicationShutdown();
    expect(runtime.rows[0]?.stoppedAt).toStrictEqual(new Date());
  });

  it('should report a clean window from the recorded stop (§7.3)', async () => {
    await livenessService.startStamping();
    await livenessService.beforeApplicationShutdown();
    const stoppedAt = new Date();
    vi.advanceTimersByTime(180_000);
    expect(await livenessService.readDowntime()).toStrictEqual({ kind: 'clean', startedAt: new Date(), stoppedAt });
  });

  it('should report the window since last known alive when no stop was recorded (§7.3)', async () => {
    await livenessService.startStamping();
    const lastAliveAt = new Date();
    // the crash takes the stamping interval with the process
    vi.clearAllTimers();
    vi.advanceTimersByTime(180_000);
    expect(await livenessService.readDowntime()).toStrictEqual({
      kind: 'since-last-alive',
      lastAliveAt,
      startedAt: new Date()
    });
  });

  it('should clear a previous stop time when stamping starts again', async () => {
    await livenessService.startStamping();
    await livenessService.beforeApplicationShutdown();
    await livenessService.startStamping();
    expect(runtime.rows[0]?.stoppedAt).toBeNull();
  });

  it('should report no downtime on a first boot', async () => {
    expect(await livenessService.readDowntime()).toBeUndefined();
  });
});
