import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { NotificationsEmitter } from '../notifications.emitter.ts';
import { NotificationsService } from '../notifications.service.ts';

describe('NotificationsService', () => {
  let loggingService: MockedInstance<LoggingService>;
  let notificationsEmitter: MockedInstance<NotificationsEmitter>;

  const createService = async (enableLifecycleNotifications: boolean): Promise<NotificationsService> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: ConfigService,
          useValue: createConfigServiceMock({ notifications: { lifecycle: enableLifecycleNotifications } })
        },
        { provide: LoggingService, useValue: loggingService },
        { provide: NotificationsEmitter, useValue: notificationsEmitter }
      ]
    }).compile();
    return moduleRef.get(NotificationsService);
  };

  beforeEach(() => {
    loggingService = MockFactory.createMock(LoggingService);
    notificationsEmitter = MockFactory.createMock(NotificationsEmitter);
  });

  it('should emit the shutdown notice when lifecycle notifications are enabled', async () => {
    const notificationsService = await createService(true);
    await notificationsService.beforeApplicationShutdown();
    expect(notificationsEmitter.notify).toHaveBeenCalledWith({ kind: 'offline', reason: 'shutdown' });
  });

  it('should stay silent on shutdown when lifecycle notifications are disabled', async () => {
    const notificationsService = await createService(false);
    await notificationsService.beforeApplicationShutdown();
    expect(notificationsEmitter.notify).not.toHaveBeenCalled();
  });

  it('should log a refused notification rather than propagate it', async () => {
    const notificationsService = await createService(true);
    notificationsEmitter.notify.mockRejectedValueOnce(new Error('mattermost refused the notice post'));

    await notificationsService.notify({ channelId: 'channel-1', kind: 'multi-mention-refusal' });

    expect(loggingService.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'failed to post the "multi-mention-refusal" notification' })
    );
  });
});
