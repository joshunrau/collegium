import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Prisma } from '@/prisma/generated/client.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';

import { TurnsService } from '../turns.service.ts';

type TurnRow = { endedAt: Date | null; id: string; startedAt: Date; status: string; statusPostId: null | string };
type EventRow = { kind: string; payload: unknown; sequence: number; turnId: string };

describe('TurnsService', () => {
  let turnsService: TurnsService;
  let turns: TurnRow[];
  let events: EventRow[];
  let eventModel: { create: (args: any) => Promise<EventRow> };
  let sequence: number;

  beforeEach(async () => {
    turns = [];
    events = [];
    sequence = 0;
    const moduleRef = await Test.createTestingModule({
      providers: [
        TurnsService,
        {
          provide: getModelToken('Turn'),
          useValue: {
            create: ({ data }: any) => {
              const row = {
                actionCount: 0,
                endedAt: null,
                id: `turn-${sequence++}`,
                startedAt: new Date(sequence),
                statusPostId: null,
                ...data
              };
              turns.push(row);
              return Promise.resolve(row);
            },
            findMany: ({ where }: any) => {
              return Promise.resolve(turns.filter((turn) => turn.status === where.status).toReversed());
            },
            groupBy: () => {
              return Promise.resolve([
                {
                  _count: { _all: 3, cachedPromptTokens: 2, costUsd: 3, reasoningTokens: 0 },
                  _sum: {
                    cachedPromptTokens: 40,
                    completionTokens: 12,
                    costUsd: 0.0412,
                    promptTokens: 90,
                    reasoningTokens: null
                  },
                  agentUsername: 'mira',
                  modelName: 'deepseek-v4-flash'
                },
                {
                  _count: { _all: 1, cachedPromptTokens: 0, costUsd: 0, reasoningTokens: 1 },
                  _sum: {
                    cachedPromptTokens: null,
                    completionTokens: 8,
                    costUsd: null,
                    promptTokens: 30,
                    reasoningTokens: 5
                  },
                  agentUsername: 'otto',
                  modelName: 'gpt-5'
                }
              ]);
            },
            update: ({ data, where }: any) => {
              const row = turns.find((turn) => turn.id === where.id);
              Object.assign(row!, data);
              return Promise.resolve(row);
            },
            updateMany: ({ data, where }: any) => {
              const matching = turns.filter((turn) => turn.status === where.status);
              matching.forEach((turn) => Object.assign(turn, data));
              return Promise.resolve({ count: matching.length });
            }
          }
        },
        {
          provide: getModelToken('TurnEvent'),
          useValue: {
            create: ({ data }: any) => {
              if (events.some((event) => event.turnId === data.turnId && event.sequence === data.sequence)) {
                throw new Prisma.PrismaClientKnownRequestError('unique', { clientVersion: '0', code: 'P2002' });
              }
              events.push(data);
              return Promise.resolve(data);
            },
            findFirst: ({ where }: any) => {
              const [last] = events
                .filter((event) => event.turnId === where.turnId)
                .toSorted((left, right) => right.sequence - left.sequence);
              return Promise.resolve(last ?? null);
            },
            findMany: ({ where }: any) => {
              return Promise.resolve(
                events
                  .filter((event) => event.turnId === where.turnId)
                  .toSorted((left, right) => left.sequence - right.sequence)
              );
            }
          }
        }
      ]
    }).compile();
    turnsService = moduleRef.get(TurnsService);
    eventModel = moduleRef.get(getModelToken('TurnEvent'));
  });

  const open = () => {
    return turnsService.open({
      agentUsername: 'mira',
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      modelName: 'deepseek-v4-flash'
    });
  };

  it('should assign a gapless sequence per turn and derive the kind column from the payload', async () => {
    const first = await open();
    const second = await open();
    await turnsService.appendEvent(first.id, { content: 'working', kind: 'assistant_message', toolCalls: [] });
    await turnsService.appendEvent(first.id, {
      callId: 'c1',
      kind: 'tool_result',
      output: 'ok',
      toolName: 'load_skill'
    });
    await turnsService.appendEvent(second.id, { content: 'hi', kind: 'assistant_message', toolCalls: [] });
    expect(events.map(({ kind, sequence: n, turnId }) => [turnId, n, kind])).toStrictEqual([
      [first.id, 0, 'assistant_message'],
      [first.id, 1, 'tool_result'],
      [second.id, 0, 'assistant_message']
    ]);
  });

  it('should close a turn with its status, action count, and usage', async () => {
    const turn = await open();
    await turnsService.close(turn.id, 'completed', {
      actionCount: 3,
      usage: {
        cachedPromptTokens: 4,
        completionTokens: 5,
        costUsd: 0.0031,
        promptTokens: 7,
        reasoningTokens: undefined
      }
    });
    expect(turns[0]).toMatchObject({
      actionCount: 3,
      cachedPromptTokens: 4,
      completionTokens: 5,
      costUsd: 0.0031,
      promptTokens: 7,
      reasoningTokens: null,
      status: 'completed'
    });
    expect(turns[0]?.endedAt).toBeInstanceOf(Date);
  });

  it('should summarize usage per agent and model, with a total no more complete than its rows', async () => {
    await expect(turnsService.summarizeUsageEndedAfter(new Date(0))).resolves.toStrictEqual({
      rows: [
        {
          agentUsername: 'mira',
          cachedPromptTokens: { coverage: 'partial', total: 40 },
          completionTokens: 12,
          costUsd: { coverage: 'full', total: 0.0412 },
          modelName: 'deepseek-v4-flash',
          promptTokens: 90,
          reasoningTokens: { coverage: 'none' },
          turnCount: 3
        },
        {
          agentUsername: 'otto',
          cachedPromptTokens: { coverage: 'none' },
          completionTokens: 8,
          costUsd: { coverage: 'none' },
          modelName: 'gpt-5',
          promptTokens: 30,
          reasoningTokens: { coverage: 'full', total: 5 },
          turnCount: 1
        }
      ],
      total: {
        cachedPromptTokens: { coverage: 'partial', total: 40 },
        completionTokens: 20,
        costUsd: { coverage: 'partial', total: 0.0412 },
        promptTokens: 120,
        reasoningTokens: { coverage: 'partial', total: 5 },
        turnCount: 4
      }
    });
  });

  it('should retry the append when a concurrent write already took the sequence it read', async () => {
    const turn = await open();
    vi.spyOn(eventModel, 'create').mockImplementationOnce(({ data }: any) => {
      events.push({ ...data, payload: { kind: 'assistant_message' } });
      throw new Prisma.PrismaClientKnownRequestError('unique', { clientVersion: '0', code: 'P2002' });
    });
    await turnsService.appendEvent(turn.id, { content: 'mine', kind: 'assistant_message', toolCalls: [] });
    expect(events.map((event) => event.sequence)).toStrictEqual([0, 1]);
  });

  it('should surface an append failure that is not a unique-constraint violation', async () => {
    const turn = await open();
    vi.spyOn(eventModel, 'create').mockRejectedValue(new Error('database is locked'));
    await expect(
      turnsService.appendEvent(turn.id, { content: 'lost', kind: 'assistant_message', toolCalls: [] })
    ).rejects.toThrow('database is locked');
  });

  it('should list a turn’s events in the order they happened', async () => {
    const turn = await open();
    await turnsService.appendEvent(turn.id, { content: 'working', kind: 'assistant_message', toolCalls: [] });
    await turnsService.appendEvent(turn.id, {
      callId: 'c1',
      kind: 'tool_result',
      output: 'ok',
      toolName: 'load_skill'
    });
    expect((await turnsService.listEvents(turn.id)).map((event) => event.kind)).toStrictEqual([
      'assistant_message',
      'tool_result'
    ]);
  });

  it('should record the status post id on the turn', async () => {
    const turn = await open();
    await turnsService.recordStatusPost(turn.id, 'post-9');
    expect(turns[0]).toMatchObject({ statusPostId: 'post-9' });
  });

  it('should abandon exactly the running turns and name the status posts they left behind', async () => {
    const running = await open();
    await turnsService.recordStatusPost(running.id, 'status-1');
    const traceless = await open();
    const done = await open();
    await turnsService.close(done.id, 'completed');

    expect(await turnsService.abandonRunning()).toStrictEqual({
      count: 2,
      statusPosts: [{ agentUsername: 'mira', channelId: 'channel-1', postId: 'status-1' }]
    });
    expect(turns.find((turn) => turn.id === running.id)?.status).toBe('abandoned');
    expect(turns.find((turn) => turn.id === traceless.id)?.status).toBe('abandoned');
    expect(turns.find((turn) => turn.id === done.id)?.status).toBe('completed');
  });
});
