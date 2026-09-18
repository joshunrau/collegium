import { defineToolset } from '@collegium/core/toolsets';
import { createServiceToken, Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { AsksService } from '@/approvals/asks.service.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope } from '@/testing/factories/tool-turn.factory.ts';

import { ToolExecutor } from '../tools.executor.ts';
import { ToolRegistry } from '../tools.registry.ts';
import { registerToolset } from '../tools.utils.ts';

type Greeter = { greet(name: string): string };
const GREETER_TOKEN = createServiceToken<Greeter>('GREETER');

const FIXTURE_TOOLSET = defineToolset({
  name: 'fixture',
  services: { greeter: GREETER_TOKEN },
  settings: z.object({ suffix: z.string().default('!') }),
  tools: {
    asker: {
      ask: (args) => ({ options: ['yes', 'no'], question: args.value }),
      description: 'Always asks.',
      execute: () => {
        throw new Error('an ask-declared tool has no body');
      },
      parameters: z.object({ value: z.string() })
    },
    disclose: {
      description: 'Returns a disclosure beside its text.',
      execute: () => {
        return Result.ok({
          disclosure: { body: 'the body', description: 'a fact', reference: 'record-1' },
          text: 'recorded'
        });
      },
      parameters: z.object({})
    },
    echo: {
      description: 'Greets through the declared context.',
      execute: (args, context) => Result.ok({ text: `${context.greeter.greet(args.value)}${context.settings.suffix}` }),
      parameters: z.object({ value: z.string() }),
      retryable: true
    },
    gated: {
      approval: (args) => ({ body: `run ${args.value}`, presentation: 'verbatim' }),
      description: 'Always gates.',
      execute: (args) => Result.ok({ text: `ran ${args.value}` }),
      parameters: z.object({ value: z.string() })
    },
    sleepy: {
      description: 'Never finishes.',
      execute: () => new Promise(() => undefined),
      parameters: z.object({}),
      timeoutMs: 10
    },
    sleepy_read: {
      description: 'Never finishes, but is a read.',
      execute: () => new Promise(() => undefined),
      parameters: z.object({}),
      retryable: true,
      timeoutMs: 10
    },
    thrower: {
      description: 'Throws.',
      execute: () => {
        throw new Error('the vendor exploded');
      },
      parameters: z.object({})
    },
    unresolved: {
      description: 'Commits something unconfirmable.',
      execute: () => Result.err({ kind: 'unresolved', message: 'the send may have left' }),
      parameters: z.object({})
    }
  }
});

const PROFILE = buildAgentProfile({
  tools: ['fixture'],
  toolSettings: new Map([['fixture', { suffix: '!' }]])
});

describe('ToolExecutor', () => {
  let approvalsService: MockedInstance<ApprovalsService>;
  let asksService: MockedInstance<AsksService>;
  let toolExecutor: ToolExecutor;

  const execute = (name: string, args: unknown) => {
    return toolExecutor.execute({
      appendEvent: () => Promise.resolve(),
      call: { arguments: args, id: 'call-1', name },
      contextText: 'Action 7 of 25 · requested by @casey: "deploy it"',
      profile: PROFILE,
      turn: buildToolTurnScope()
    });
  };

  beforeEach(async () => {
    approvalsService = MockFactory.createMock(ApprovalsService);
    asksService = MockFactory.createMock(AsksService);
    const registered = registerToolset(
      FIXTURE_TOOLSET,
      () => ({ greet: (name: string) => `hello ${name}` }),
      () => {
        throw new Error('no storage is declared by the fixture');
      }
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        ToolExecutor,
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: AsksService, useValue: asksService },
        { provide: ToolRegistry, useValue: new ToolRegistry([registered], [PROFILE]) }
      ]
    }).compile();
    toolExecutor = moduleRef.get(ToolExecutor);
  });

  it('executes an ungated tool with the context its toolset declared (§4)', async () => {
    const attempt = await execute('fixture__echo', { value: 'casey' });
    expect(attempt).toStrictEqual({ kind: 'continue', output: 'hello casey!' });
    expect(approvalsService.request).not.toHaveBeenCalled();
  });

  it('should hand an answered question back as the call’s own result (§3.7a)', async () => {
    asksService.request.mockResolvedValue(Result.ok({ answerText: 'yes', byUsername: 'casey', kind: 'answered' }));
    const attempt = await execute('fixture__asker', { value: 'ship it?' });
    expect(attempt).toStrictEqual({ kind: 'continue', output: 'yes' });
    expect(asksService.request).toHaveBeenCalledWith(
      expect.objectContaining({ options: ['yes', 'no'], question: 'ship it?' })
    );
  });

  it('should end the turn when a pending question is cancelled (§7.5)', async () => {
    asksService.request.mockResolvedValue(Result.ok({ kind: 'cancelled', reason: 'stop' }));
    const attempt = await execute('fixture__asker', { value: 'ship it?' });
    expect(attempt).toStrictEqual({
      detail: 'the pending question was cancelled by stop',
      kind: 'terminal',
      status: 'stopped'
    });
  });

  it('feeds malformed arguments back under the name the model spelled (§1)', async () => {
    const attempt = await execute('fixture__echo', { value: 5 });
    expect(attempt.kind).toBe('continue');
    expect((attempt as { output: string }).output).toContain('invalid arguments for fixture__echo');
  });

  it('ends the turn on a name outside the set (§6.1)', async () => {
    const attempt = await execute('ghost__tool', {});
    expect(attempt).toMatchObject({ kind: 'terminal', status: 'semantic_error' });
  });

  it('gates on approval presence, running only once approved (§5)', async () => {
    approvalsService.request.mockResolvedValue(Result.ok({ byUsername: 'casey', kind: 'approved' }));
    const attempt = await execute('fixture__gated', { value: 'deploy' });
    expect(approvalsService.request).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'call-1',
        contextText: 'Action 7 of 25 · requested by @casey: "deploy it"',
        payloadPresentation: 'verbatim',
        payloadText: 'run deploy',
        toolName: 'gated',
        toolNamespace: 'fixture'
      })
    );
    expect(attempt).toStrictEqual({ kind: 'continue', output: 'ran deploy' });
  });

  it('ends the turn on a bare denial, naming the denier and the display name (§5.4)', async () => {
    approvalsService.request.mockResolvedValue(Result.ok({ byUsername: 'casey', kind: 'denied' }));
    const attempt = await execute('fixture__gated', { value: 'deploy' });
    expect(attempt).toStrictEqual({
      detail: '@casey denied fixture::gated',
      kind: 'terminal',
      status: 'denied'
    });
  });

  it('continues with the reason on a reasoned denial (§5.4)', async () => {
    approvalsService.request.mockResolvedValue(
      Result.ok({ byUsername: 'casey', kind: 'denied-with-reason', reason: 'not that host' })
    );
    const attempt = await execute('fixture__gated', { value: 'deploy' });
    expect(attempt).toStrictEqual({ kind: 'continue', output: 'denied: not that host' });
  });

  it('reports a timed-out read as a plain failure the model hears (§7.2)', async () => {
    const attempt = await execute('fixture__sleepy_read', {});
    expect(attempt).toStrictEqual({ kind: 'continue', output: 'fixture__sleepy_read timed out after 10ms' });
  });

  it('ends the turn on a timed-out mutation, which may have landed (§7.2)', async () => {
    const attempt = await execute('fixture__sleepy', {});
    expect(attempt).toMatchObject({ kind: 'terminal', status: 'side_effect_ambiguous' });
    expect((attempt as { detail: string }).detail).toContain('fixture::sleepy timed out after 10ms');
  });

  it('ends the turn when the body throws (§7.1)', async () => {
    const attempt = await execute('fixture__thrower', {});
    expect(attempt).toMatchObject({ kind: 'terminal', status: 'semantic_error' });
    expect((attempt as { detail: string }).detail).toContain('fixture::thrower threw: the vendor exploded');
  });

  it('ends the turn on an unresolved outcome rather than tell the model (§7.1)', async () => {
    const attempt = await execute('fixture__unresolved', {});
    expect(attempt).toStrictEqual({
      detail: 'the send may have left',
      kind: 'terminal',
      status: 'side_effect_ambiguous'
    });
  });

  it('passes a returned disclosure through for the turn to write (§3)', async () => {
    const attempt = await execute('fixture__disclose', {});
    expect(attempt).toStrictEqual({
      disclosure: { body: 'the body', description: 'a fact', reference: 'record-1' },
      kind: 'continue',
      output: 'recorded'
    });
  });
});
