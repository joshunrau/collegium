import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { TypingIndicatorService } from '../typing-indicator.service.ts';

const INPUT = { agentUsername: 'mira', channelId: 'channel-1' };

describe('TypingIndicatorService', () => {
  let signalTyping: ReturnType<typeof vi.fn>;
  let typingIndicatorService: TypingIndicatorService;

  beforeEach(async () => {
    vi.useFakeTimers();
    signalTyping = vi.fn();
    const transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue({ signalTyping } as unknown as ChatTransport);
    const moduleRef = await Test.createTestingModule({
      providers: [TypingIndicatorService, { provide: TransportRegistry, useValue: transportRegistry }]
    }).compile();
    typingIndicatorService = moduleRef.get(TypingIndicatorService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should signal immediately so the indicator shows before the first refresh', () => {
    typingIndicatorService.start(INPUT);
    expect(signalTyping).toHaveBeenCalledWith('channel-1');
  });

  it('should re-signal inside the substrate expiry for as long as it runs', () => {
    typingIndicatorService.start(INPUT);
    vi.advanceTimersByTime(12_000);
    expect(signalTyping).toHaveBeenCalledTimes(4);
  });

  it('should stop signalling once stopped', () => {
    typingIndicatorService.start(INPUT).stop();
    vi.advanceTimersByTime(12_000);
    expect(signalTyping).toHaveBeenCalledOnce();
  });

  it('should drop a live signal on shutdown rather than hold the event loop open', () => {
    typingIndicatorService.start(INPUT);
    typingIndicatorService.onApplicationShutdown();
    vi.advanceTimersByTime(12_000);
    expect(signalTyping).toHaveBeenCalledOnce();
  });
});
