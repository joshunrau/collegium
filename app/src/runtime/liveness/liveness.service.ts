import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { LoggingService } from '@/logging/logging.service.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model } from '@/prisma/prisma.types.ts';

import type { Downtime } from '../runtime.types.ts';

/** §7.3 — the stamp bounds how imprecise a crash's downtime window can be; it is not a deployment knob */
const STAMP_INTERVAL_MS = 30_000;

/** the record is one row; the id names it rather than a magic uuid nobody could look up */
const RUNTIME_ROW_ID = 'process';

/**
 * §7.3 — the process's own record of itself, which is what the downtime window is measured against.
 * A clean shutdown records its stop time and the window is exact; a crash records nothing and the
 * periodic stamp is what bounds it. Stamping starts only once boot has read the last life's record,
 * because the first stamp overwrites it.
 */
@Injectable()
export class LivenessService implements OnApplicationShutdown {
  private stamping: NodeJS.Timeout | undefined;

  constructor(
    private readonly loggingService: LoggingService,
    @InjectModel('Runtime') private readonly runtime: Model<'Runtime'>
  ) {}

  /** the crash path never reaches this, which is what leaves `stoppedAt` null and names the window imprecise */
  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.stamping);
    this.stamping = undefined;
    await this.stamp(new Date());
  }

  /** how far back this boot's downtime reaches and how well it is known; undefined on a first boot */
  async readDowntime(): Promise<Downtime | undefined> {
    const record = await this.runtime.findUnique({ where: { id: RUNTIME_ROW_ID } });
    if (!record) {
      return undefined;
    }
    const startedAt = new Date();
    return record.stoppedAt === null
      ? { kind: 'since-last-alive', lastAliveAt: record.lastAliveAt, startedAt }
      : { kind: 'clean', startedAt, stoppedAt: record.stoppedAt };
  }

  /** the first stamp lands now rather than an interval from now, so a process that dies young still has one */
  async startStamping(): Promise<void> {
    await this.stamp(null);
    this.stamping = setInterval(() => {
      void this.stamp(null).catch((error: unknown) => {
        this.loggingService.error(new Error('failed to stamp the process as alive', { cause: error }));
      });
    }, STAMP_INTERVAL_MS);
    this.stamping.unref();
  }

  private async stamp(stoppedAt: Date | null): Promise<void> {
    const lastAliveAt = new Date();
    await this.runtime.upsert({
      create: { id: RUNTIME_ROW_ID, lastAliveAt, stoppedAt },
      update: { lastAliveAt, stoppedAt },
      where: { id: RUNTIME_ROW_ID }
    });
  }
}
