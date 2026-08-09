import { withTimeout } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';

import { LoggingService } from '@/logging/logging.service.ts';
import { NotificationsService } from '@/notifications/notifications.service.ts';
import type { SystemEvent } from '@/notifications/notifications.types.ts';

@Injectable()
export class CrashHandler implements OnApplicationBootstrap {
  private readonly crashNoticeTimeoutMs = 2000;

  constructor(
    private readonly loggingService: LoggingService,
    private readonly notificationsService: NotificationsService
  ) {}

  onApplicationBootstrap() {
    process.on('uncaughtException', (error) => {
      this.exitAfterAnnouncing(new Error('uncaught exception, exiting', { cause: error }));
    });
    process.on('unhandledRejection', (reason) => {
      this.exitAfterAnnouncing(new Error('unhandled rejection, exiting', { cause: reason }));
    });
  }

  private exitAfterAnnouncing(error: Error): void {
    this.loggingService.error(error);
    void withTimeout(
      this.notificationsService.notify({ kind: 'offline', reason: 'crash' } satisfies SystemEvent.Offline),
      this.crashNoticeTimeoutMs,
      () => undefined
    ).finally(() => process.exit(1));
  }
}
