import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  const editedTexts = () => transport.updatePost.mock.calls.map(([, { text }]) => text);

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
    const handle = statusPostService.open(OPEN_INPUT);
    handle.appendTrace('→ `read_memory`');
    await handle.close('completed', new Map());

    expect(transport.send).toHaveBeenCalledExactlyOnceWith({
      channelId: 'channel-1',
      text: '⏳ _working…_\n→ `read_memory`'
    });
    expect(conversationsService.record).toHaveBeenCalledExactlyOnceWith(
      {
        attachments: [],
        authorKind: 'agent',
        authorUsername: 'mira',
        channelId: 'channel-1',
        createdAt: CREATED_AT,
        id: 'status-1',
        message: '⏳ _working…_\n→ `read_memory`'
      },
      { kind: 'status', turnId: 'turn-1' }
    );
    expect(turnsService.recordStatusPost).toHaveBeenCalledExactlyOnceWith('turn-1', 'status-1');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should state how long the turn ran on its outcome line (§8.1)', async () => {
    vi.useFakeTimers();
    const handle = statusPostService.open(OPEN_INPUT);

    handle.appendTrace('→ `load_skill`');
    vi.advanceTimersByTime(200_000);
    await handle.close('completed', new Map());

    expect(editedTexts()).toContain('✅ _done (3m 20s)_\n→ `load_skill`');
  });

  it('should coalesce the lines queued while an edit is in flight into the next edit (§8.1)', async () => {
    let finishOpening: () => void = () => undefined;
    transport.send.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOpening = () => resolve(Result.ok({ createdAt: CREATED_AT, postId: 'status-1' }));
      })
    );
    const handle = statusPostService.open(OPEN_INPUT);

    handle.appendTrace('→ `load_skill`');
    handle.appendTrace('→ `write_memory`');
    handle.appendTrace('→ `read_memory`');
    finishOpening();
    await vi.waitFor(() => expect(transport.updatePost).toHaveBeenCalledOnce());
    await handle.close('completed', new Map());

    const text = '⏳ _working…_\n→ `load_skill`\n→ `write_memory`\n→ `read_memory`';
    expect(transport.send).toHaveBeenCalledOnce();
    expect(editedTexts()).toStrictEqual([text, '✅ _done (0s)_\n→ `load_skill`\n→ `write_memory`\n→ `read_memory`']);
    expect(conversationsService.updateAuthoredMessage).toHaveBeenCalledWith('status-1', text);
  });

  it('should replace transient text rather than accumulate it, and clear it on close', async () => {
    const handle = statusPostService.open(OPEN_INPUT);

    handle.appendTrace('→ `load_skill`');
    handle.setTransient('reading the skill');
    handle.setTransient('writing it up');
    await vi.waitFor(() => expect(transport.updatePost).toHaveBeenCalledOnce());
    await handle.close('killed', new Map());

    expect(editedTexts()).toStrictEqual([
      '⏳ _working…_\n→ `load_skill`\n_writing it up_',
      '⏹️ _killed (0s)_\n→ `load_skill`'
    ]);
  });

  it('should post nothing for a turn that never traced anything', async () => {
    await statusPostService.open(OPEN_INPUT).close('completed', new Map());

    expect(transport.send).not.toHaveBeenCalled();
    expect(transport.updatePost).not.toHaveBeenCalled();
  });

  it('should give up on the post once opening it fails', async () => {
    transport.send.mockResolvedValue(Result.err(FAILURE));
    const handle = statusPostService.open(OPEN_INPUT);

    handle.appendTrace('→ `load_skill`');
    await handle.close('completed', new Map());
    handle.appendTrace('→ `write_memory`');
    await handle.close('completed', new Map());

    expect(transport.send).toHaveBeenCalledOnce();
    expect(transport.updatePost).not.toHaveBeenCalled();
    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'failed to open a status post: the channel is archived' })
    );
  });

  it('should log a failed edit and keep editing on the next line', async () => {
    transport.updatePost.mockResolvedValueOnce(Result.err(FAILURE));
    const handle = statusPostService.open(OPEN_INPUT);

    handle.appendTrace('→ `load_skill`');
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledOnce());
    handle.appendTrace('→ `write_memory`');
    await vi.waitFor(() => expect(loggingService.error).toHaveBeenCalledOnce());
    handle.appendTrace('→ `read_memory`');
    await handle.close('completed', new Map());

    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'failed to edit status post status-1: the channel is archived' })
    );
    expect(conversationsService.updateAuthoredMessage).toHaveBeenLastCalledWith(
      'status-1',
      '✅ _done (0s)_\n→ `load_skill`\n→ `write_memory`\n→ `read_memory`'
    );
  });

  it('should keep the post alive when the store rejects the opening record', async () => {
    conversationsService.record.mockRejectedValue(new Error('database is locked'));
    const handle = statusPostService.open(OPEN_INPUT);

    handle.appendTrace('→ `load_skill`');
    await handle.close('completed', new Map());

    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'failed to record status post status-1' })
    );
    expect(transport.updatePost).toHaveBeenCalledExactlyOnceWith('status-1', {
      text: '✅ _done (0s)_\n→ `load_skill`'
    });
  });

  describe('closeAbandoned', () => {
    const ABANDONED = { agentUsername: 'mira', channelId: 'channel-1', postId: 'status-1' };

    it('should replace only the outcome line of the post a restart left mid-trace (§7.3)', async () => {
      conversationsService.findAuthoredMessage.mockResolvedValue('⏳ _working…_\n→ `load_skill`\n_still reading_');

      await statusPostService.closeAbandoned(ABANDONED);

      const text = '⚪ _abandoned — the process restarted mid-turn_\n→ `load_skill`\n_still reading_';
      expect(transport.updatePost).toHaveBeenCalledExactlyOnceWith('status-1', { text });
      expect(conversationsService.updateAuthoredMessage).toHaveBeenCalledExactlyOnceWith('status-1', text);
    });

    it('should leave nothing behind for a turn that opened no status post (§8.1)', async () => {
      conversationsService.findAuthoredMessage.mockResolvedValue(undefined);

      await statusPostService.closeAbandoned(ABANDONED);

      expect(transport.updatePost).not.toHaveBeenCalled();
    });

    it('should log a refused edit rather than fail the boot that asked for it (§7.3)', async () => {
      conversationsService.findAuthoredMessage.mockResolvedValue('⏳ _working…_');
      transport.updatePost.mockResolvedValue(Result.err(FAILURE));

      await expect(statusPostService.closeAbandoned(ABANDONED)).resolves.toBeUndefined();

      expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: 'failed to close abandoned status post status-1: the channel is archived' })
      );
    });
  });

  it('should log when the store rejects an edit', async () => {
    conversationsService.updateAuthoredMessage.mockRejectedValue(new Error('database is locked'));
    const handle = statusPostService.open(OPEN_INPUT);

    handle.appendTrace('→ `load_skill`');
    await handle.close('completed', new Map());

    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'failed to update the stored status post status-1' })
    );
  });
});
