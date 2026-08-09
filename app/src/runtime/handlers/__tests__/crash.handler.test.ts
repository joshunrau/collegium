import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoggingService } from '@/logging/logging.service.ts';
import { NotificationsService } from '@/notifications/notifications.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { CrashHandler } from '../crash.handler.ts';

function registeredListener(event: 'uncaughtException'): (error: Error, origin: NodeJS.UncaughtExceptionOrigin) => void;
function registeredListener(event: 'unhandledRejection'): (reason: unknown, promise: Promise<unknown>) => void;
function registeredListener(event: string) {
  const registration = vi.mocked(process).on.mock.calls.find(([registeredEvent]) => registeredEvent === event);
  if (!registration) {
    throw new Error(`no listener registered for "${event}"`);
  }
  return registration[1].bind(undefined);
}

describe('CrashHandler', () => {
  let crashHandler: CrashHandler;
  let loggingService: MockedInstance<LoggingService>;
  let notificationsService: MockedInstance<NotificationsService>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CrashHandler,
        MockFactory.createForService(LoggingService),
        MockFactory.createForService(NotificationsService)
      ]
    }).compile();
    crashHandler = moduleRef.get(CrashHandler);
    loggingService = moduleRef.get(LoggingService);
    notificationsService = moduleRef.get(NotificationsService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should announce an uncaught exception before exiting', async () => {
    const cause = new Error('boom');
    notificationsService.notify.mockResolvedValue(undefined);
    vi.spyOn(process, 'on').mockReturnValue(process);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    crashHandler.onApplicationBootstrap();
    registeredListener('uncaughtException')(cause, 'uncaughtException');

    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ cause, message: 'uncaught exception, exiting' })
    );
    expect(notificationsService.notify).toHaveBeenCalledExactlyOnceWith({ kind: 'offline', reason: 'crash' });
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1));
  });

  it('should announce an unhandled rejection before exiting', async () => {
    const reason = 'rejected';
    notificationsService.notify.mockResolvedValue(undefined);
    vi.spyOn(process, 'on').mockReturnValue(process);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    crashHandler.onApplicationBootstrap();
    registeredListener('unhandledRejection')(reason, Promise.resolve());

    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ cause: reason, message: 'unhandled rejection, exiting' })
    );
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1));
  });

  it('should exit after the crash notice timeout', async () => {
    vi.useFakeTimers();
    notificationsService.notify.mockReturnValue(new Promise(() => undefined));
    vi.spyOn(process, 'on').mockReturnValue(process);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    crashHandler.onApplicationBootstrap();
    registeredListener('uncaughtException')(new Error('boom'), 'uncaughtException');
    await vi.advanceTimersByTimeAsync(2000);

    expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1);
  });
});
