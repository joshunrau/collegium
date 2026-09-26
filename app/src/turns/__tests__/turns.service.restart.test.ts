import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { PrismaService } from '@/prisma/prisma.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { createMigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';
import type { MigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';

import { TurnsService } from '../turns.service.ts';

describe('TurnsService abandonment against the store (§7.3)', () => {
  let database: MigratedDatabase;
  let turnsService: TurnsService;

  beforeAll(async () => {
    database = createMigratedDatabase();
    const moduleRef = await Test.createTestingModule({
      providers: [
        TurnsService,
        { provide: ConfigService, useValue: createConfigServiceMock({ turns: { chainLengthLimit: 10 } }) },
        { provide: PrismaService, useValue: database.client },
        { provide: getModelToken('Turn'), useValue: database.client.turn },
        { provide: getModelToken('TurnEvent'), useValue: database.client.turnEvent }
      ]
    }).compile();
    turnsService = moduleRef.get(TurnsService);
  });

  afterAll(() => database.dispose());

  const open = async (triggeringPostId?: string) => {
    const opened = await turnsService.open({
      activationKind: 'addressed',
      agentUsername: 'mira',
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      modelName: 'deepseek-v4-flash',
      rootPostId: triggeringPostId ?? 'post-root',
      triggeringPostId
    });
    return opened.unwrap();
  };

  const statusOf = async (turnId: string) => {
    return (await database.client.turn.findUniqueOrThrow({ where: { id: turnId } })).status;
  };

  it('should abandon exactly the running turns and name the status posts they left behind', async () => {
    const running = await open();
    await turnsService.recordStatusPost(running.id, 'status-1');
    const traceless = await open();
    const done = await open();
    await turnsService.close(done.id, 'completed');

    const abandoned = await turnsService.abandonRunning(() => false);
    expect(abandoned.statusPosts).toStrictEqual([
      { agentUsername: 'mira', channelId: 'channel-1', postId: 'status-1' }
    ]);
    expect(abandoned.turns.map(({ turnId }) => turnId).toSorted()).toStrictEqual([running.id, traceless.id].toSorted());
    expect(abandoned.withEffects).toStrictEqual([]);
    expect(await statusOf(running.id)).toBe('abandoned');
    expect(await statusOf(traceless.id)).toBe('abandoned');
    expect(await statusOf(done.id)).toBe('completed');
  });

  it('should keep the latest running totals of a turn a restart abandons, and count it in usage (§8.2)', async () => {
    const opened = await turnsService.open({
      activationKind: 'addressed',
      agentUsername: 'owen',
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      modelName: 'deepseek-v4-flash',
      rootPostId: 'post-root',
      triggeringPostId: undefined
    });
    const turn = opened.unwrap();
    const usage = (promptTokens: number) => ({
      cachedPromptTokens: undefined,
      completionTokens: 2,
      costUsd: 0.01,
      promptTokens,
      reasoningTokens: undefined
    });
    const since = new Date(Date.now() - 1_000);
    await turnsService.recordUsage(turn.id, usage(100));
    await turnsService.recordUsage(turn.id, usage(250));

    await turnsService.abandonRunning(() => false);
    const report = await turnsService.summarizeUsageEndedAfter(since);
    expect(report.rows.find((row) => row.agentUsername === 'owen')).toMatchObject({
      costUsd: { coverage: 'full', total: 0.01 },
      promptTokens: 250,
      turnCount: 1
    });
  });

  describe('which abandoned turns had effects (§7.3)', () => {
    /** only reads, and `builtins::now`, are safe to run again here */
    const isSafeToRepeat = (_agentUsername: string, [namespace, name]: readonly [string, string]) => {
      return namespace === 'builtins' || name === 'read';
    };

    const called = (turnId: string, callId: string, toolName: readonly [string, string]) => {
      return turnsService.appendEvent(turnId, {
        content: '',
        kind: 'assistant_message',
        toolCalls: [{ args: {}, callId, toolName: [...toolName] as [string, string] }]
      });
    };

    const sorted = async () => {
      const abandoned = await turnsService.abandonRunning(isSafeToRepeat);
      return {
        withEffects: abandoned.withEffects.map(({ turnId }) => turnId),
        withoutEffects: abandoned.withoutEffects.map(({ madeCompletion, turnId }) => [turnId, madeCompletion])
      };
    };

    it('should run again a turn that made no completion, or one whose every call is safe to repeat', async () => {
      const steered = await open('post-1');
      await turnsService.appendEvent(steered.id, { byUsername: 'ada', kind: 'steering_received', text: 'and this' });
      const reading = await open('post-2');
      await called(reading.id, 'call-1', ['workspace', 'read']);
      await called(reading.id, 'call-2', ['builtins', 'now']);
      expect(await sorted()).toStrictEqual({
        withEffects: [],
        withoutEffects: [
          [reading.id, true],
          [steered.id, false]
        ]
      });
    });

    it('should count a final reply, a park on a person, and a call that may have run and is not safe to repeat', async () => {
      const replied = await open('post-1');
      await turnsService.appendEvent(replied.id, { content: 'done', kind: 'assistant_message', toolCalls: [] });
      const parked = await open('post-2');
      await turnsService.appendEvent(parked.id, {
        approvalId: 'a-1',
        kind: 'approval_requested',
        payloadText: 'write notes.md',
        toolName: ['workspace', 'write']
      });
      const writing = await open('post-3');
      await called(writing.id, 'call-1', ['workspace', 'write']);
      expect((await sorted()).withEffects.toSorted()).toStrictEqual([parked.id, replied.id, writing.id].toSorted());
    });

    it('should not count a call whose result says it never ran', async () => {
      const refused = await open('post-1');
      await called(refused.id, 'call-1', ['workspace', 'write']);
      await turnsService.appendEvent(refused.id, {
        callId: 'call-1',
        kind: 'tool_result',
        output: 'refused: path is required',
        toolName: ['workspace', 'write'],
        traceMark: { ran: false, text: '⚠️ arguments not valid' }
      });
      expect(await sorted()).toStrictEqual({ withEffects: [], withoutEffects: [[refused.id, true]] });
    });
  });
});
