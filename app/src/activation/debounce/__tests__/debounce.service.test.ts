import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { DebounceService } from '../debounce.service.ts';

const KEY = { agentUsername: 'mira', authorUsername: 'casey', channelId: 'channel-1' };

describe('DebounceService', () => {
  let debounceService: DebounceService;
  let matured: string[];

  beforeEach(async () => {
    vi.useFakeTimers();
    matured = [];
    const configService = MockFactory.createMock(ConfigService);
    configService.get.mockReturnValue({ ceilingMs: 15_000, windowMs: 3000 });
    const moduleRef = await Test.createTestingModule({
      providers: [DebounceService, { provide: ConfigService, useValue: configService }]
    }).compile();
    debounceService = moduleRef.get(DebounceService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should fold messages from the same human in the same channel into one maturation', () => {
    debounceService.schedule(KEY, () => matured.push('first'));
    debounceService.schedule(KEY, () => matured.push('second'));
    vi.advanceTimersByTime(3000);
    expect(matured).toStrictEqual(['first']);
  });

  it('should reset the window on each further message', () => {
    debounceService.schedule(KEY, () => matured.push('first'));
    vi.advanceTimersByTime(2000);
    debounceService.schedule(KEY, () => matured.push('second'));
    vi.advanceTimersByTime(2000);
    expect(matured).toStrictEqual([]);
    vi.advanceTimersByTime(1000);
    expect(matured).toStrictEqual(['first']);
  });

  it('should mature at the ceiling however much the human keeps typing', () => {
    debounceService.schedule(KEY, () => matured.push('first'));
    for (let elapsed = 2000; elapsed <= 14_000; elapsed += 2000) {
      vi.advanceTimersByTime(2000);
      debounceService.schedule(KEY, () => matured.push('later'));
    }
    expect(matured).toStrictEqual([]);
    vi.advanceTimersByTime(1000);
    expect(matured).toStrictEqual(['first']);
  });

  it('should hold batches in memory only, empty again once matured', () => {
    debounceService.schedule(KEY, () => matured.push('first'));
    expect(debounceService.isDebouncing('channel-1')).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(debounceService.isDebouncing('channel-1')).toBe(false);
  });

  it('should report a channel quiet while only another channel is mid-batch', () => {
    debounceService.schedule({ ...KEY, channelId: 'channel-2' }, () => matured.push('first'));
    expect(debounceService.isDebouncing('channel-1')).toBe(false);
    expect(debounceService.isDebouncing('channel-2')).toBe(true);
  });

  it('should drop every pending batch on shutdown rather than maturing it', () => {
    debounceService.schedule(KEY, () => matured.push('first'));
    debounceService.onApplicationShutdown();
    vi.advanceTimersByTime(15_000);
    expect(matured).toStrictEqual([]);
    expect(debounceService.isDebouncing('channel-1')).toBe(false);
  });

  it('should reset a pending window on an unaddressed follow-up without creating a batch', () => {
    expect(debounceService.touch(KEY)).toBe(false);
    vi.advanceTimersByTime(15_000);
    expect(matured).toStrictEqual([]);
    debounceService.schedule(KEY, () => matured.push('first'));
    vi.advanceTimersByTime(2000);
    expect(debounceService.touch(KEY)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(matured).toStrictEqual([]);
    vi.advanceTimersByTime(1000);
    expect(matured).toStrictEqual(['first']);
  });

  it('should debounce different humans independently', () => {
    debounceService.schedule(KEY, () => matured.push('casey'));
    vi.advanceTimersByTime(2000);
    debounceService.schedule({ ...KEY, authorUsername: 'ana' }, () => matured.push('ana'));
    vi.advanceTimersByTime(1000);
    expect(matured).toStrictEqual(['casey']);
    vi.advanceTimersByTime(2000);
    expect(matured).toStrictEqual(['casey', 'ana']);
  });
});
