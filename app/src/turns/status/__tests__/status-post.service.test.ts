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

const NOTHING_CHANGED = '✎ _may have changed: nothing_';

describe('StatusPostService', () => {
  let conversationsService: MockedInstance<ConversationsService>;
  let loggingService: MockedInstance<LoggingService>;
  let statusPostService: StatusPostService;
  let transport: {
    maxPostSizeChars: Mock<ChatTransport['maxPostSizeChars']>;
    send: Mock<ChatTransport['send']>;
    updatePost: Mock<ChatTransport['updatePost']>;
  };
  let turnsService: MockedInstance<TurnsService>;

  const editedTexts = () => transport.updatePost.mock.calls.map(([, { text }]) => text);

  beforeEach(async () => {
    transport = {
      maxPostSizeChars: vi.fn(() => Promise.resolve(Result.ok(16_383))),
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
    handle.appendTrace({ kind: 'call', toolName: 'read_memory' });
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledOnce());
    await handle.close('completed');

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

    handle.appendTrace({ kind: 'call', toolName: 'load_skill' });
    vi.advanceTimersByTime(200_000);
    await handle.close('completed');

    expect(editedTexts()).toContain(`✅ _done (3m 20s)_\n→ \`load_skill\`\n${NOTHING_CHANGED}`);
  });

  it('should coalesce the lines queued while an edit is in flight into the next edit (§8.1)', async () => {
    vi.useFakeTimers();
    let finishEditing: () => void = () => undefined;
    const handle = statusPostService.open(OPEN_INPUT);

    handle.appendTrace({ kind: 'call', toolName: 'load_skill' });
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledOnce());
    transport.updatePost.mockReturnValueOnce(
      new Promise((resolve) => {
        finishEditing = () => resolve(Result.ok());
      })
    );
    handle.appendTrace({ kind: 'call', toolName: 'write_memory' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.updatePost).toHaveBeenCalledOnce();
    handle.appendTrace({ kind: 'call', toolName: 'read_memory' });
    handle.appendTrace({ kind: 'call', toolName: 'list_memory' });
    finishEditing();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.updatePost).toHaveBeenCalledTimes(2);
    await handle.close('completed');

    const queued = '⏳ _working…_\n→ `load_skill`\n→ `write_memory`\n→ `read_memory`\n→ `list_memory`';
    expect(transport.send).toHaveBeenCalledOnce();
    expect(editedTexts()).toStrictEqual([
      '⏳ _working…_\n→ `load_skill`\n→ `write_memory`',
      queued,
      `✅ _done (2s)_\n→ \`load_skill\`\n→ \`write_memory\`\n→ \`read_memory\`\n→ \`list_memory\`\n${NOTHING_CHANGED}`
    ]);
    expect(conversationsService.updateAuthoredMessage).toHaveBeenCalledWith('status-1', queued);
  });

  it('should replace transient text rather than accumulate it, and clear it on close', async () => {
    vi.useFakeTimers();
    const handle = statusPostService.open(OPEN_INPUT);

    handle.appendTrace({ kind: 'call', toolName: 'load_skill' });
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledOnce());
    handle.setTransient('reading the skill');
    handle.setTransient('writing it up');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.updatePost).toHaveBeenCalledOnce();
    await handle.close('killed');

    expect(editedTexts()).toStrictEqual([
      '⏳ _working…_\n→ `load_skill`\n_writing it up_',
      expect.stringMatching(/^⏹️ _killed \(\d+s\)_\n→ `load_skill`\n✎ _may have changed: nothing_$/u)
    ]);
  });

  it('should coalesce edits to one per second, and never delay the closing edit (§8.1)', async () => {
    vi.useFakeTimers();
    const handle = statusPostService.open(OPEN_INPUT);

    handle.appendTrace({ kind: 'call', toolName: 'load_skill' });
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledOnce());
    handle.appendTrace({ kind: 'call', toolName: 'write_memory' });
    await vi.advanceTimersByTimeAsync(400);
    handle.appendTrace({ kind: 'call', toolName: 'read_memory' });
    await vi.advanceTimersByTimeAsync(400);
    expect(transport.updatePost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(transport.updatePost).toHaveBeenCalledOnce();
    handle.appendTrace({ kind: 'call', toolName: 'list_memory' });
    await handle.close('completed');

    expect(editedTexts()).toStrictEqual([
      '⏳ _working…_\n→ `load_skill`\n→ `write_memory`\n→ `read_memory`',
      `✅ _done (1s)_\n→ \`load_skill\`\n→ \`write_memory\`\n→ \`read_memory\`\n→ \`list_memory\`\n${NOTHING_CHANGED}`
    ]);
  });

  it('should mark a line after the fact with what the call came to (§8.1)', async () => {
    const handle = statusPostService.open(OPEN_INPUT);

    const write = handle.appendTrace({
      detail: 'report.txt',
      effect: '(9 bytes)',
      kind: 'call',
      toolName: 'workspace::write'
    });
    handle.markTrace(write, { ran: false, text: '🛑 denied by @casey' });
    handle.recordEffect('shell::run');
    handle.recordEffect('shell::run');
    await handle.close('completed');

    expect(editedTexts().at(-1)).toBe(
      '✅ _done (0s)_\n→ `workspace::write report.txt` 🛑 denied by @casey\n✎ _may have changed: shell::run ×2_'
    );
  });

  it('should bound the post by the substrate’s limit, falling back to a conservative one it cannot read (§8.1)', async () => {
    transport.maxPostSizeChars.mockResolvedValue(Result.err(FAILURE));
    const handle = statusPostService.open(OPEN_INPUT);

    for (let index = 0; index < 80; index += 1) {
      handle.appendTrace({
        detail: `https://x.example/${'p'.repeat(60)}/${index}`,
        kind: 'call',
        toolName: 'web::fetch'
      });
    }
    await handle.close('completed');

    const closing = editedTexts().at(-1)!;
    expect(closing.length).toBeLessThanOrEqual(4000);
    expect(closing).toContain('earlier calls; the full trace is in /collegium trace');
    expect(closing.endsWith(NOTHING_CHANGED)).toBe(true);
    expect(loggingService.warn).toHaveBeenCalledWith(expect.stringContaining('using 4000'));
  });

  it('should post nothing for a turn that never traced anything', async () => {
    await statusPostService.open(OPEN_INPUT).close('completed');

    expect(transport.send).not.toHaveBeenCalled();
    expect(transport.updatePost).not.toHaveBeenCalled();
  });

  it('should give up on the post once opening it fails', async () => {
    transport.send.mockResolvedValue(Result.err(FAILURE));
    const handle = statusPostService.open(OPEN_INPUT);

    handle.appendTrace({ kind: 'call', toolName: 'load_skill' });
    await handle.close('completed');
    handle.appendTrace({ kind: 'call', toolName: 'write_memory' });
    await handle.close('completed');

    expect(transport.send).toHaveBeenCalledOnce();
    expect(transport.updatePost).not.toHaveBeenCalled();
    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'failed to open a status post: the channel is archived' })
    );
  });

  it('should log a failed edit and keep editing on the next line', async () => {
    vi.useFakeTimers();
    transport.updatePost.mockResolvedValueOnce(Result.err(FAILURE));
    const handle = statusPostService.open(OPEN_INPUT);

    handle.appendTrace({ kind: 'call', toolName: 'load_skill' });
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledOnce());
    handle.appendTrace({ kind: 'call', toolName: 'write_memory' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(loggingService.error).toHaveBeenCalledOnce();
    handle.appendTrace({ kind: 'call', toolName: 'read_memory' });
    await handle.close('completed');

    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'failed to edit status post status-1: the channel is archived' })
    );
    expect(conversationsService.updateAuthoredMessage).toHaveBeenLastCalledWith(
      'status-1',
      expect.stringMatching(
        /^✅ _done \(\d+s\)_\n→ `load_skill`\n→ `write_memory`\n→ `read_memory`\n✎ _may have changed: nothing_$/u
      )
    );
  });

  it('should keep the post alive when the store rejects the opening record', async () => {
    conversationsService.record.mockRejectedValue(new Error('database is locked'));
    const handle = statusPostService.open(OPEN_INPUT);

    handle.appendTrace({ kind: 'call', toolName: 'load_skill' });
    await handle.close('completed');

    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'failed to record status post status-1' })
    );
    expect(transport.updatePost).toHaveBeenCalledExactlyOnceWith('status-1', {
      text: `✅ _done (0s)_\n→ \`load_skill\`\n${NOTHING_CHANGED}`
    });
  });

  describe('closeAbandoned', () => {
    const ABANDONED = { agentUsername: 'mira', channelId: 'channel-1', postId: 'status-1' };

    it('should replace only the outcome line of the post a restart left mid-trace (§7.3)', async () => {
      conversationsService.findAuthoredMessage.mockResolvedValue('⏳ _working…_\n→ `load_skill`\n_still reading_');

      await statusPostService.closeAbandoned(ABANDONED);

      const text =
        '⚪ _abandoned — the process restarted mid-turn_\n→ `load_skill`\n_still reading_\n✎ _may have changed: not recorded; the process restarted mid-turn_';
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

    handle.appendTrace({ kind: 'call', toolName: 'load_skill' });
    await handle.close('completed');

    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'failed to update the stored status post status-1' })
    );
  });
});
