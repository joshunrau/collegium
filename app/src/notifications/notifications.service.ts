import { Injectable } from '@nestjs/common';
import type { BeforeApplicationShutdown } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import { NotificationsEmitter } from './notifications.emitter.ts';

import type { SystemEvent } from './notifications.types.ts';

@Injectable()
export class NotificationsService implements BeforeApplicationShutdown {
  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
    private readonly notificationsEmitter: NotificationsEmitter
  ) {}

  async beforeApplicationShutdown(): Promise<void> {
    if (this.configService.get('app.enableLifecycleNotifications')) {
      await this.notify({ kind: 'offline', reason: 'shutdown' } satisfies SystemEvent.Offline);
    }
  }

  async notify(event: SystemEvent): Promise<void> {
    try {
      await this.notificationsEmitter.notify(event);
    } catch (error) {
      this.loggingService.error(new Error(`failed to post the "${event.kind}" notification`, { cause: error }));
    }
  }
}
