import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { PrismaService } from '@/prisma/prisma.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { createMigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';
import type { MigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';
import { TurnsService } from '@/turns/turns.service.ts';

import { ResultReader } from '../reading/result.reader.ts';
import { RESULTS_TOOLSET } from '../results.toolset.ts';

const read = RESULTS_TOOLSET.tools.read;

/** a record whose text says where it is, so a stretch read from it can be checked by eye */
const RECORD = Array.from({ length: 1_000 }, (_, index) => `line ${String(index).padStart(4, '0')}\n`).join('');

describe('RESULTS_TOOLSET, against the store (§3.8)', () => {
  let database: MigratedDatabase;
  let turnsService: TurnsService;
  let resultReader: ResultReader;

  beforeAll(async () => {
    database = createMigratedDatabase();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ResultReader,
        TurnsService,
        { provide: ConfigService, useValue: createConfigServiceMock({ turns: { chainLengthLimit: 10 } }) },
        { provide: PrismaService, useValue: database.client },
        { provide: getModelToken('Turn'), useValue: database.client.turn },
        { provide: getModelToken('TurnEvent'), useValue: database.client.turnEvent }
      ]
    }).compile();
    turnsService = moduleRef.get(TurnsService);
    resultReader = moduleRef.get(ResultReader);
  });

  afterAll(() => database.dispose());

  /** a turn holding one result recorded under a view of `viewChars`, and its reference */
  const recordResult = async (viewChars: number) => {
    const opened = await turnsService.open({
      activationKind: 'addressed',
      agentUsername: 'mira',
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      drainedFromPostId: undefined,
      modelName: 'deepseek-v4-flash',
      rootPostId: 'post-1',
      triggeringPostId: 'post-1'
    });
    const turn = opened.unwrap();
    await turnsService.appendEvent(turn.id, { content: '', kind: 'assistant_message', toolCalls: [] });
    const { sequence } = await turnsService.appendEvent(turn.id, {
      callId: 'c1',
      kind: 'tool_result',
      output: RECORD,
      presentedAs: { shownChars: viewChars, viewChars },
      toolName: ['workspace', 'read']
    });
    const context = {
      moments: { format: () => '14:02 UTC' },
      results: resultReader,
      turn: buildToolTurnScope({ turnId: turn.id })
    };
    return { context, ref: `r${sequence}` };
  };

  it('should read a stretch sized to fit its view whole, saying where to read on', async () => {
    const { context, ref } = await recordResult(2_000);
    const { text } = (await executeTool(read, { offset: 1_000, ref }, context)).unwrap();
    expect(text.length).toBeLessThanOrEqual(2_000);
    const [heading, ...rest] = text.split('\n');
    const to = Number(/–([\d,]+) of/u.exec(heading!)![1]!.replaceAll(',', ''));
    expect(heading).toBe(
      `result ${ref}, characters 1,000–${to.toLocaleString('en-US')} of 10,000 (recorded at 14:02 UTC):`
    );
    expect(rest.join('\n')).toBe(`${RECORD.slice(1_000, to)}\nread on with offset=${to}`);
  });

  it('should read on at the view its record was shown in, however wide', async () => {
    const { context, ref } = await recordResult(6_000);
    const { text } = (await executeTool(read, { ref }, context)).unwrap();
    expect(text.length).toBeGreaterThan(5_800);
    expect(text.length).toBeLessThanOrEqual(6_000);
  });

  it('should find phrases anywhere in the record, at offsets into it', async () => {
    const { context, ref } = await recordResult(2_000);
    const { text } = (await executeTool(read, { find: ['line 0987'], ref }, context)).unwrap();
    expect(text).toContain(`"line 0987" — 1 match at ${RECORD.indexOf('line 0987')}`);
  });

  it('should refuse a reference naming no result of this turn, listing the ones it has', async () => {
    const { context, ref } = await recordResult(2_000);
    const refused = await executeTool(read, { ref: 'r99' }, context);
    expect(refused.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: `no result r99 in this turn; its newest results are ${ref}. A reference lasts only for the turn that made the call; in a later turn, make the call again.`
    });
  });

  it('should resolve no result of another turn, whatever its sequence', async () => {
    const { ref } = await recordResult(2_000);
    const { context } = await recordResult(2_000);
    const other = await executeTool(
      read,
      { ref },
      { ...context, turn: buildToolTurnScope({ turnId: 'turn-elsewhere' }) }
    );
    expect(other.error).toMatchObject({ kind: 'invalid-arguments' });
  });
});
