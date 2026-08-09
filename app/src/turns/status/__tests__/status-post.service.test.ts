import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { ChatTransport } from '@/chat/chat.transport.ts';
import type { ChatFailure } from '@/chat/chat.types.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { TurnsService } from '../../turns.service.ts';
import { StatusPostService } from '../status-post.service.ts';

const CREATED_AT = new Date('2026-01-01T12:00:00.000Z');

const FAILURE: ChatFailure = { kind: 'api', message: 'the channel is archived' };

const OPEN_INPUT = { agentUsername: 'mira', channelId: 'channel-1', turnId: 'turn-1' };

describe('StatusPostService', () => {
  let conversationsService: MockedInstance<ConversationsService>;
  let loggingService: MockedInstance<LoggingService>;
  let statusPostService: StatusPostService;
  let transport: { send: Mock<ChatTransport['send']>; updatePost: Mock<ChatTransport['updatePost']> };
  let turnsService: MockedInstance<TurnsService>;

  beforeEach(async () => {
    transport = {
      send: vi.fn(() => Promise.resolve(Result.ok({ createdAt: CREATED_AT, postId: 'status-1' }))),
      updatePost: vi.fn(() => Promise.resolve(Result.ok()))
    };
    conversationsService = MockFactory.createMock(ConversationsService);
    conversationsService.record.mockResolvedValue(true);
    conversationsService.updateAuthoredMessage.mockResolvedValue(undefined);
    loggingService = MockFactory.createMock(LoggingService);
    turnsService = MockFactory.createMock(TurnsService);
    turnsService.recordStatusPost.mockResolvedValue(undefined);
    const transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue(transport as unknown as ChatTransport);
    const moduleRef = await Test.createTestingModule({
      providers: [
        StatusPostService,
        { provide: ConversationsService, useValue: conversationsService },
        { provide: LoggingService, useValue: loggingService },
        { provide: TransportRegistry, useValue: transportRegistry },
        { provide: TurnsService, useValue: turnsService }
      ]
    }).compile();
    statusPostService = moduleRef.get(StatusPostService);
  });

  it('should open the post on the first trace line and record it as the turn status post', async () => {
    await statusPostService.open(OPEN_INPUT).appendTrace('→ `read_memory`');

    expect(transport.send).toHaveBeenCalledExactlyOnceWith({
      channelId: 'channel-1',
      text: '⏳ _working…_\n→ `read_memory`'
    });
    expect(conversationsService.record).toHaveBeenCalledExactlyOnceWith(
      {
        authorKind: 'agent',
        authorUsername: 'mira',
        channelId: 'channel-1',
        createdAt: CREATED_AT,
        id: 'status-1',
        message: '⏳ _working…_\n→ `read_memory`'
      },
      'turn-1'
    );
    expect(turnsService.recordStatusPost).toHaveBeenCalledExactlyOnceWith('turn-1', 'status-1');
  });

  it('should edit the one post in place as the trace accumulates and keep the stored copy current', async () => {
    const handle = statusPostService.open(OPEN_INPUT);

    await handle.appendTrace('→ `load_skill`');
    await handle.appendTrace('→ `write_memory`');

    const text = '⏳ _working…_\n→ `load_skill`\n→ `write_memory`';
    expect(transport.send).toHaveBeenCalledOnce();
    expect(transport.updatePost).toHaveBeenCalledExactlyOnceWith('status-1', { text });
    expect(conversationsService.updateAuthoredMessage).toHaveBeenCalledExactlyOnceWith('status-1', text);
  });

  it('should replace transient text rather than accumulate it', async () => {
    const handle = statusPostService.open(OPEN_INPUT);

    await handle.appendTrace('→ `load_skill`');
    await handle.setTransient('reading the skill');
    await handle.setTransient('writing it up');

    expect(transport.updatePost).toHaveBeenLastCalledWith('status-1', {
      text: '⏳ _working…_\n→ `load_skill`\n_writing it up_'
    });
  });

  it('should close the post on its outcome and clear the transient text', async () => {
    const handle = statusPostService.open(OPEN_INPUT);

    await handle.appendTrace('→ `load_skill`');
    await handle.setTransient('reading the skill');
    await handle.close('killed');

    expect(transport.updatePost).toHaveBeenLastCalledWith('status-1', { text: '⏹️ _killed_\n→ `load_skill`' });
  });

  it('should post nothing for a turn that never traced anything', async () => {
    await statusPostService.open(OPEN_INPUT).close('completed');

    expect(transport.send).not.toHaveBeenCalled();
    expect(transport.updatePost).not.toHaveBeenCalled();
  });

  it('should give up on the post once opening it fails', async () => {
    transport.send.mockResolvedValue(Result.err(FAILURE));
    const handle = statusPostService.open(OPEN_INPUT);

    await handle.appendTrace('→ `load_skill`');
    await handle.appendTrace('→ `write_memory`');

    expect(transport.send).toHaveBeenCalledOnce();
    expect(transport.updatePost).not.toHaveBeenCalled();
    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'failed to open a status post: the channel is archived' })
    );
  });

  it('should log a failed edit and keep editing on the next trace line', async () => {
    transport.updatePost.mockResolvedValueOnce(Result.err(FAILURE));
    const handle = statusPostService.open(OPEN_INPUT);

    await handle.appendTrace('→ `load_skill`');
    await handle.appendTrace('→ `write_memory`');
    await handle.appendTrace('→ `read_memory`');

    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'failed to edit status post status-1: the channel is archived' })
    );
    expect(conversationsService.updateAuthoredMessage).toHaveBeenCalledExactlyOnceWith(
      'status-1',
      '⏳ _working…_\n→ `load_skill`\n→ `write_memory`\n→ `read_memory`'
    );
  });

  it('should keep the post alive when the store rejects the opening record', async () => {
    conversationsService.record.mockRejectedValue(new Error('database is locked'));
    const handle = statusPostService.open(OPEN_INPUT);

    await handle.appendTrace('→ `load_skill`');
    await handle.close('completed');

    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'failed to record status post status-1' })
    );
    expect(transport.updatePost).toHaveBeenCalledExactlyOnceWith('status-1', { text: '✅ _done_\n→ `load_skill`' });
  });

  it('should log when the store rejects an edit', async () => {
    conversationsService.updateAuthoredMessage.mockRejectedValue(new Error('database is locked'));
    const handle = statusPostService.open(OPEN_INPUT);

    await handle.appendTrace('→ `load_skill`');
    await handle.close('completed');

    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'failed to update the stored status post status-1' })
    );
  });
});
