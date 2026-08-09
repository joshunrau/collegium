import type { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { z } from 'zod';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ToolExecutor } from '../tools.executor.ts';
import { TOOL_LIBRARY_PROVIDER, ToolRegistry } from '../tools.registry.ts';

import type { ToolName } from '../tools.types.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const echoExecute = vi.fn((args: { text: string }) => Promise.resolve(Result.ok({ text: `echo: ${args.text}` })));
const failingExecute = vi.fn<() => Promise<Result<Tool.Output, Tool.Failure>>>();
const slowWriteExecute = vi.fn(async () => {
  await sleep(50);
  return Result.ok({ text: 'landed' });
});

const ungated = { getApprovalRequirements: () => ({ kind: 'ungated' as const }), variant: 'ungated' as const };

const FIXTURES: readonly Tool.Any[] = [
  {
    ...ungated,
    description: 'echoes its input',
    execute: echoExecute,
    isRetryable: () => true,
    name: 'echo_fixture',
    parameters: z.object({ text: z.string() }),
    renderTraceDetail: (args: { text: string }) => args.text,
    timeoutMs: 1000
  },
  {
    ...ungated,
    description: 'a slow read',
    execute: async () => {
      await sleep(50);
      return Result.ok({ text: 'read' });
    },
    isRetryable: () => true,
    name: 'slow_read_fixture',
    parameters: z.object({}),
    renderTraceDetail: () => '',
    timeoutMs: 10
  },
  {
    ...ungated,
    description: 'a slow mutation',
    execute: slowWriteExecute,
    isRetryable: () => false,
    name: 'slow_write_fixture',
    parameters: z.object({}),
    renderTraceDetail: () => '',
    timeoutMs: 10
  },
  {
    ...ungated,
    description: 'a slow tool whose actions differ in retryability',
    execute: async () => {
      await sleep(50);
      return Result.ok({ text: 'done' });
    },
    isRetryable: (args: { mutating: boolean }) => !args.mutating,
    name: 'dynamic_retry_fixture',
    parameters: z.object({ mutating: z.boolean() }),
    renderTraceDetail: () => '',
    timeoutMs: 10
  },
  {
    ...ungated,
    description: 'throws',
    execute: () => {
      throw new Error('boom');
    },
    isRetryable: () => true,
    name: 'throwing_fixture',
    parameters: z.object({}),
    renderTraceDetail: () => '',
    timeoutMs: 1000
  },
  {
    ...ungated,
    description: 'returns whichever failure the test asks for',
    execute: failingExecute,
    isRetryable: () => true,
    name: 'failing_fixture',
    parameters: z.object({}),
    renderTraceDetail: () => '',
    timeoutMs: 1000
  }
];

const PROFILE = {
  tools: FIXTURES.map((tool) => tool.name) as unknown as readonly ToolName[],
  username: 'mira'
} as AgentProfile;

const SCOPE = { agentUsername: 'mira', channelId: 'channel-1', turnId: 'turn-1' } as Tool.TurnScope;

describe('ToolExecutor', () => {
  let approvalsService: MockedInstance<ApprovalsService>;
  let gatedExecute: Mock;
  let toolExecutor: ToolExecutor;

  beforeEach(async () => {
    vi.clearAllMocks();
    approvalsService = MockFactory.createMock(ApprovalsService);
    gatedExecute = vi.fn(() => Promise.resolve(Result.ok({ text: 'written' })));
    const gatedFixture: Tool.Any = {
      description: 'a gated mutation',
      execute: gatedExecute as never,
      getApprovalRequirements: (args: { path: string }) => ({
        kind: 'gated',
        payload: { body: `write ${args.path}`, presentation: 'collapse' }
      }),
      isRetryable: () => false,
      name: 'gated_fixture',
      parameters: z.object({ path: z.string() }),
      renderTraceDetail: (args: { path: string }) => args.path,
      timeoutMs: 1000,
      variant: 'gated'
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ToolExecutor,
        ToolRegistry,
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: TOOL_LIBRARY_PROVIDER, useValue: [...FIXTURES, gatedFixture] }
      ]
    }).compile();
    toolExecutor = moduleRef.get(ToolExecutor);
  });

  const execute = (name: string, args: unknown = {}) =>
    toolExecutor.execute({
      appendEvent: () => Promise.resolve(),
      call: { arguments: args, id: 'call-1', name },
      profile: { ...PROFILE, tools: [...PROFILE.tools, 'gated_fixture'] as unknown as readonly ToolName[] },
      turn: SCOPE
    });

  it('should run a tool and return its output', async () => {
    expect(await execute('echo_fixture', { text: 'hi' })).toStrictEqual({ kind: 'continue', output: 'echo: hi' });
  });

  it('should feed rejected arguments back to the model rather than terminating', async () => {
    const attempt = await execute('echo_fixture', { text: 42 });
    expect(attempt).toMatchObject({ kind: 'continue' });
    expect((attempt as { output: string }).output).toContain('invalid arguments for echo_fixture');
    expect(echoExecute).not.toHaveBeenCalled();
  });

  it('should terminate as a semantic failure on a tool that does not exist', async () => {
    expect(await execute('send_mail')).toMatchObject({ kind: 'terminal', status: 'semantic_error' });
  });

  it("should terminate as a semantic failure on a tool outside the agent's configured set", async () => {
    const bare = { tools: [], username: 'tess' } as unknown as AgentProfile;
    const attempt = await toolExecutor.execute({
      appendEvent: () => Promise.resolve(),
      call: { arguments: {}, id: 'call-1', name: 'echo_fixture' },
      profile: bare,
      turn: SCOPE
    });
    expect(attempt).toMatchObject({ kind: 'terminal', status: 'semantic_error' });
  });

  it('should terminate as a semantic failure when the tool body throws', async () => {
    expect(await execute('throwing_fixture')).toMatchObject({
      detail: 'throwing_fixture threw: boom',
      kind: 'terminal',
      status: 'semantic_error'
    });
  });

  it('should exit side_effect_ambiguous when a mutation times out, never re-executing it', async () => {
    const attempt = await execute('slow_write_fixture');
    expect(attempt).toMatchObject({ kind: 'terminal', status: 'side_effect_ambiguous' });
    expect(slowWriteExecute).toHaveBeenCalledTimes(1);
  });

  it('should tell the model a timed-out read failed and continue the turn', async () => {
    expect(await execute('slow_read_fixture')).toStrictEqual({
      kind: 'continue',
      output: 'slow_read_fixture timed out after 10ms'
    });
  });

  it("should classify a dynamic tool's timeout by the call's own args (§7.2)", async () => {
    expect(await execute('dynamic_retry_fixture', { mutating: false })).toStrictEqual({
      kind: 'continue',
      output: 'dynamic_retry_fixture timed out after 10ms'
    });
    expect(await execute('dynamic_retry_fixture', { mutating: true })).toMatchObject({
      kind: 'terminal',
      status: 'side_effect_ambiguous'
    });
  });

  it('should terminate as a semantic failure when the body reports an exception', async () => {
    failingExecute.mockResolvedValue(Result.err({ kind: 'exception', message: 'the store was unreachable' }));
    expect(await execute('failing_fixture')).toStrictEqual({
      detail: 'the store was unreachable',
      kind: 'terminal',
      status: 'semantic_error'
    });
  });

  it('should terminate as a semantic failure when the body reports an unknown tool', async () => {
    failingExecute.mockResolvedValue(Result.err({ kind: 'unknown-tool', message: 'no tool named "x" exists' }));
    expect(await execute('failing_fixture')).toStrictEqual({
      detail: 'no tool named "x" exists',
      kind: 'terminal',
      status: 'semantic_error'
    });
  });

  it('should end the turn as side_effect_ambiguous when the body reports an unresolved outcome (§7.2)', async () => {
    failingExecute.mockResolvedValue(Result.err({ kind: 'unresolved', message: 'the send may or may not have left' }));
    expect(await execute('failing_fixture')).toStrictEqual({
      detail: 'the send may or may not have left',
      kind: 'terminal',
      status: 'side_effect_ambiguous'
    });
  });

  it('should feed a body-reported argument rejection back to the model and continue the turn', async () => {
    failingExecute.mockResolvedValue(Result.err({ kind: 'invalid-arguments', message: 'no memory "m-9" exists' }));
    expect(await execute('failing_fixture')).toStrictEqual({ kind: 'continue', output: 'no memory "m-9" exists' });
  });

  describe('the gate (§5.4, §6.2)', () => {
    it('should execute an ungated tool without asking anyone', async () => {
      await execute('echo_fixture', { text: 'hi' });
      expect(approvalsService.request).not.toHaveBeenCalled();
    });

    it('should request approval with the full rendered payload and execute on approve', async () => {
      approvalsService.request.mockResolvedValue(Result.ok({ byUsername: 'casey', kind: 'approved' }));
      const attempt = await execute('gated_fixture', { path: 'notes.md' });
      expect(approvalsService.request).toHaveBeenCalledWith(
        expect.objectContaining({ payloadText: 'write notes.md', toolName: 'gated_fixture', turnId: 'turn-1' })
      );
      expect(attempt).toStrictEqual({ kind: 'continue', output: 'written' });
    });

    it('should terminate the turn on a bare denial without executing (§5.4)', async () => {
      approvalsService.request.mockResolvedValue(Result.ok({ byUsername: 'casey', kind: 'denied' }));
      const attempt = await execute('gated_fixture', { path: 'notes.md' });
      expect(attempt).toMatchObject({ kind: 'terminal', status: 'denied' });
      expect(gatedExecute).not.toHaveBeenCalled();
    });

    it('should feed the reason back as the tool result and continue on denial with reason (§5.4)', async () => {
      approvalsService.request.mockResolvedValue(
        Result.ok({ byUsername: 'casey', kind: 'denied-with-reason', reason: 'wrong file' })
      );
      const attempt = await execute('gated_fixture', { path: 'notes.md' });
      expect(attempt).toStrictEqual({ kind: 'continue', output: 'denied: wrong file' });
      expect(gatedExecute).not.toHaveBeenCalled();
    });

    it('should close the turn under the cancelling command without executing (§7.5)', async () => {
      approvalsService.request.mockResolvedValue(Result.ok({ kind: 'cancelled', reason: 'stop' }));
      const attempt = await execute('gated_fixture', { path: 'notes.md' });
      expect(attempt).toMatchObject({ kind: 'terminal', status: 'stopped' });
      expect(gatedExecute).not.toHaveBeenCalled();
    });

    it.each([
      { reason: 'halt', status: 'halted' },
      { reason: 'kill', status: 'killed' },
      { reason: 'restart', status: 'halted' }
    ] as const)('should end a $reason cancellation as $status (§7.5)', async ({ reason, status }) => {
      approvalsService.request.mockResolvedValue(Result.ok({ kind: 'cancelled', reason }));
      expect(await execute('gated_fixture', { path: 'notes.md' })).toStrictEqual({
        detail: `the pending approval was cancelled by ${reason}`,
        kind: 'terminal',
        status
      });
    });

    it('should end the turn as an outage when the prompt cannot be delivered', async () => {
      approvalsService.request.mockResolvedValue(
        Result.err({ kind: 'prompt-undeliverable', message: 'mattermost is down' })
      );
      const attempt = await execute('gated_fixture', { path: 'notes.md' });
      expect(attempt).toMatchObject({ kind: 'terminal', status: 'provider_outage' });
      expect(gatedExecute).not.toHaveBeenCalled();
    });

    it('should feed an over-long refused command back to the model to shorten, continuing the turn (§6.2)', async () => {
      approvalsService.request.mockResolvedValue(
        Result.err({ actualChars: 5000, kind: 'payload-too-large', limitChars: 4000 })
      );
      const attempt = await execute('gated_fixture', { path: 'notes.md' });
      expect(attempt).toMatchObject({ kind: 'continue' });
      expect((attempt as { output: string }).output).toContain('too long to present for approval');
      expect(gatedExecute).not.toHaveBeenCalled();
    });
  });
});
