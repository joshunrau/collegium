import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ClearingService } from '@/clearing/clearing.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ClearHandler } from '../clear.handler.ts';

describe('ClearHandler', () => {
  let clearHandler: ClearHandler;
  let clearingService: MockedInstance<ClearingService>;

  const handle = (text: string) => {
    return clearHandler.handle({
      channelId: 'channel-1',
      text,
      triggerId: 'trigger-1',
      userId: 'casey-id',
      username: 'casey'
    });
  };

  beforeEach(async () => {
    clearingService = MockFactory.createMock(ClearingService);
    clearingService.prepare.mockResolvedValue(Result.ok());
    const moduleRef = await Test.createTestingModule({
      providers: [ClearHandler, { provide: ClearingService, useValue: clearingService }]
    }).compile();
    clearHandler = moduleRef.get(ClearHandler);
  });

  it('should answer anything but the one flag with the usage line', async () => {
    expect(await handle('--everything')).toStrictEqual({
      audience: 'invoker',
      text: 'Usage: /collegium clear [--memories]'
    });
    expect(clearingService.prepare).not.toHaveBeenCalled();
  });

  it('should hand the request to the clear with the flag and the trigger id, answering nothing', async () => {
    expect(await handle('--memories')).toStrictEqual({ audience: 'invoker', text: '' });
    expect(clearingService.prepare).toHaveBeenCalledExactlyOnceWith({
      byUsername: 'casey',
      channelId: 'channel-1',
      memories: true,
      triggerId: 'trigger-1'
    });
  });

  it('should tell the invoker why the clear was refused, naming the busy agents (§8.5)', async () => {
    clearingService.prepare.mockResolvedValue(Result.err({ agentUsernames: ['mira'], kind: 'busy' }));
    expect(await handle('')).toStrictEqual({
      audience: 'invoker',
      text: 'A turn is running here (mira). Stop or kill it first: /collegium stop or /collegium kill.'
    });
  });
});
