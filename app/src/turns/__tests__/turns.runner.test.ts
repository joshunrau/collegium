import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import type { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import type { InferenceClient } from '@/inference/inference.client.ts';
import { InferenceRegistry } from '@/inference/inference.registry.ts';
import type { CompletionResult, InferenceFailure, TokenUsage } from '@/inference/inference.types.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolExecutor } from '@/tools/tools.executor.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';
import type { ToolAttempt } from '@/tools/tools.types.ts';
import { WebService } from '@/web/web.service.ts';

import { ContextAssembler } from '../context/context.assembler.ts';
import { TurnControlRegistry } from '../control/turn-control.registry.ts';
import { TurnFoldRegistry } from '../folding/turn-fold.registry.ts';
import { StatusPostService } from '../status/status-post.service.ts';
import { TurnRunner } from '../turns.runner.ts';
import { TurnsService } from '../turns.service.ts';
import { TypingIndicatorService } from '../typing/typing-indicator.service.ts';

import type { Turn } from '../turns.types.ts';

const PROFILE = {
  contextBudgetTokens: 1000,
  expertise: 'testing',
  memoryCaps: { maxBodyChars: 4000, maxDescriptionChars: 200, maxEntries: 50 },
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  skills: [],
  systemPrompt: 'You are Mira.',
  tools: [],
  username: 'mira',
  workspaceDir: '/tmp/workspaces/mira'
} as AgentProfile;

const text = (content: string, usage?: TokenUsage): CompletionResult => ({ content, kind: 'text', usage });

const toolUse = (names: string[], content = '', usage?: TokenUsage): CompletionResult => ({
  content,
  kind: 'tool-use',
  toolCalls: names.map((name, index) => ({ arguments: {}, id: `call-${index}`, name })),
  usage
});

describe('TurnRunner', () => {
  let approvalsService: MockedInstance<ApprovalsService>;
  let complete: Mock<InferenceClient['complete']>;
  let contextAssembler: MockedInstance<ContextAssembler>;
  let conversationsService: MockedInstance<ConversationsService>;
  let multiMentionPolicy: MockedInstance<MultiMentionPolicy>;
  let sends: { channelId: string; text: string }[];
  let statusHandle: { appendTrace: any; close: any; setTransient: any };
  let toolExecutor: MockedInstance<ToolExecutor>;
  let toolRegistry: MockedInstance<ToolRegistry>;
  let transportSend: Mock<(message: { channelId: string; text: string }) => Promise<unknown>>;
  let turnControlRegistry: TurnControlRegistry;
  let turnFoldRegistry: TurnFoldRegistry;
  let turnRunner: TurnRunner;
  let loggingService: MockedInstance<LoggingService>;
  let turnsService: MockedInstance<TurnsService>;
  let typingHandle: { stop: Mock };
  let typingIndicatorService: MockedInstance<TypingIndicatorService>;
  let webService: MockedInstance<WebService>;

  beforeEach(async () => {
    approvalsService = MockFactory.createMock(ApprovalsService);
    approvalsService.request.mockResolvedValue(Result.ok({ byUsername: 'casey', kind: 'denied' }));
    complete = vi.fn<InferenceClient['complete']>();
    conversationsService = MockFactory.createMock(ConversationsService);
    conversationsService.record.mockResolvedValue(true);
    sends = [];
    statusHandle = {
      appendTrace: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      setTransient: vi.fn().mockResolvedValue(undefined)
    };
    contextAssembler = MockFactory.createMock(ContextAssembler);
    contextAssembler.assemble.mockResolvedValue({
      request: {
        messages: [{ content: '@casey: hi', role: 'user' }],
        modelName: 'deepseek-v4-flash',
        systemPrompt: 'sys',
        tools: []
      },
      windowPostIds: new Set(['post-0'])
    });
    const inferenceRegistry = MockFactory.createMock(InferenceRegistry);
    inferenceRegistry.getClientForModel.mockReturnValue({ complete });
    multiMentionPolicy = MockFactory.createMock(MultiMentionPolicy);
    multiMentionPolicy.refuses.mockReturnValue(false);
    multiMentionPolicy.stripAgentMentions.mockImplementation((content) => content);
    const statusPostService = MockFactory.createMock(StatusPostService);
    statusPostService.open.mockReturnValue(statusHandle);
    toolExecutor = MockFactory.createMock(ToolExecutor);
    toolExecutor.execute.mockResolvedValue({ kind: 'continue', output: 'ok' } satisfies ToolAttempt);
    toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.describeCall.mockReturnValue(undefined);
    transportSend = vi.fn((message: { channelId: string; text: string }) => {
      sends.push(message);
      return Promise.resolve(Result.ok({ createdAt: new Date(5000), postId: `post-${sends.length}` }));
    });
    const transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue({ send: transportSend } as unknown as ChatTransport);
    typingHandle = { stop: vi.fn() };
    typingIndicatorService = MockFactory.createMock(TypingIndicatorService);
    typingIndicatorService.start.mockReturnValue(typingHandle);
    webService = MockFactory.createMock(WebService);
    turnsService = MockFactory.createMock(TurnsService);
    turnsService.open.mockResolvedValue({ id: 'turn-1' } as Turn);
    turnsService.appendEvent.mockResolvedValue(undefined);
    turnsService.close.mockResolvedValue(undefined);
    turnsService.recordStatusPost.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        TurnRunner,
        TurnControlRegistry,
        TurnFoldRegistry,
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: ContextAssembler, useValue: contextAssembler },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: InferenceRegistry, useValue: inferenceRegistry },
        MockFactory.createForService(LoggingService),
        { provide: MultiMentionPolicy, useValue: multiMentionPolicy },
        { provide: StatusPostService, useValue: statusPostService },
        { provide: ToolExecutor, useValue: toolExecutor },
        { provide: ToolRegistry, useValue: toolRegistry },
        { provide: TransportRegistry, useValue: transportRegistry },
        { provide: TurnsService, useValue: turnsService },
        { provide: TypingIndicatorService, useValue: typingIndicatorService },
        { provide: WebService, useValue: webService }
      ]
    }).compile();
    turnRunner = moduleRef.get(TurnRunner);
    loggingService = moduleRef.get(LoggingService);
    turnControlRegistry = moduleRef.get(TurnControlRegistry);
    turnFoldRegistry = moduleRef.get(TurnFoldRegistry);
  });

  const run = () => turnRunner.run({ channelId: 'channel-1', depth: 0, profile: PROFILE });

  const runFolding = () =>
    turnRunner.run({ channelId: 'channel-1', depth: 0, foldAuthorUsername: 'casey', profile: PROFILE });

  const offerFragment = (postId: string): boolean =>
    turnFoldRegistry.offer({ agentUsername: 'mira', authorUsername: 'casey', channelId: 'channel-1', postId });

  it('should disclose in the status post when a draining turn’s window fell short of the 👀 promise', async () => {
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await turnRunner.run({
      channelId: 'channel-1',
      depth: 0,
      drainedFromPostId: 'post-out-of-reach',
      profile: PROFILE
    });
    expect(statusHandle.appendTrace).toHaveBeenCalledWith(
      '⚠️ _context could not reach back to the earliest queued message_'
    );
  });

  it('should signal typing for the duration of a completion and no longer', async () => {
    complete.mockImplementationOnce(() => {
      expect(typingIndicatorService.start).toHaveBeenCalledWith({
        agentUsername: 'mira',
        channelId: 'channel-1'
      });
      expect(typingHandle.stop).not.toHaveBeenCalled();
      return Promise.resolve(Result.ok(text('done')));
    });
    await run();
    expect(typingHandle.stop).toHaveBeenCalledOnce();
  });

  it('should stop signalling typing when the completion fails', async () => {
    complete.mockResolvedValueOnce(Result.err({ kind: 'transport' } satisfies InferenceFailure.Transport));
    await run();
    expect(typingHandle.stop).toHaveBeenCalledOnce();
  });

  it('should end the turn on text with no tool call, posting it as final output', async () => {
    complete.mockResolvedValueOnce(Result.ok(text('all done')));
    const outcome = await run();
    expect(outcome.status).toBe('completed');
    expect(sends.at(-1)).toMatchObject({ text: 'all done' });
    expect(conversationsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ authorKind: 'agent', message: 'all done' }),
      'turn-1'
    );
    expect(statusHandle.close).toHaveBeenCalledWith('completed');
  });

  it('should discard the completion that only saw the first fragment and answer the whole message', async () => {
    complete.mockImplementationOnce(() => {
      offerFragment('post-2');
      return Promise.resolve(Result.ok(text('answering half a question')));
    });
    complete.mockResolvedValueOnce(Result.ok(text('answering all of it')));
    await runFolding();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(contextAssembler.assemble).toHaveBeenCalledTimes(2);
    expect(sends.map((send) => send.text)).toStrictEqual(['answering all of it']);
  });

  it('should stop folding at the limit however long the human keeps typing', async () => {
    complete.mockImplementation(() => {
      offerFragment('post-n');
      return Promise.resolve(Result.ok(text('done')));
    });
    const outcome = await runFolding();
    expect(complete).toHaveBeenCalledTimes(4);
    expect(outcome.status).toBe('completed');
  });

  it('should stop absorbing once it has acted on a completion', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['shell'])));
    complete.mockImplementationOnce(() => {
      expect(offerFragment('post-2')).toBe(false);
      return Promise.resolve(Result.ok(text('done')));
    });
    await runFolding();
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('should fold nothing into a turn no human started', async () => {
    complete.mockImplementationOnce(() => {
      expect(offerFragment('post-2')).toBe(false);
      return Promise.resolve(Result.ok(text('done')));
    });
    await run();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('should strip agent mentions and post the delegation-limit notice at depth ten', async () => {
    multiMentionPolicy.stripAgentMentions.mockImplementation((content: string) => content.replace('@owen ', ''));
    complete.mockResolvedValueOnce(Result.ok(text('@owen please continue')));
    const outcome = await turnRunner.run({ channelId: 'channel-1', depth: 10, profile: PROFILE });
    expect(outcome.status).toBe('completed');
    expect(sends.map((send) => send.text)).toStrictEqual([
      "I would have asked a colleague but I've reached the delegation limit — someone needs to pick this up.",
      'please continue'
    ]);
  });

  it('should execute tools, record the trace, and loop until the model emits text', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'], 'checking')));
    complete.mockResolvedValueOnce(Result.ok(text('found it')));
    const outcome = await run();
    expect(outcome.status).toBe('completed');
    expect(turnsService.appendEvent.mock.calls.map(([, event]: any) => event.kind)).toStrictEqual([
      'assistant_message',
      'tool_result'
    ]);
    const secondRequest = complete.mock.calls[1]![0];
    expect(secondRequest.messages.map((message: { role: string }) => message.role)).toStrictEqual([
      'user',
      'assistant',
      'tool'
    ]);
    expect(statusHandle.setTransient).toHaveBeenCalledWith('checking');
    expect(statusHandle.appendTrace).toHaveBeenCalledWith('→ `lookup_fixture`');
    expect(turnsService.close).toHaveBeenCalledWith('turn-1', 'completed', expect.objectContaining({ actionCount: 1 }));
  });

  it('should trace a call with the detail the tool renders from its arguments', async () => {
    toolRegistry.describeCall.mockReturnValue('navigate https://northmoor.example/');
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    complete.mockResolvedValueOnce(Result.ok(text('found it')));
    await run();
    expect(toolRegistry.describeCall).toHaveBeenCalledWith({
      args: {},
      name: 'lookup_fixture',
      profile: PROFILE
    });
    expect(statusHandle.appendTrace).toHaveBeenCalledWith('→ `lookup_fixture navigate https://northmoor.example/`');
  });

  it('should not count load_skill, a memory body load, or framework posting against the budget', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['load_skill', 'read_memory', 'lookup_fixture'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await run();
    expect(turnsService.close).toHaveBeenCalledWith('turn-1', 'completed', expect.objectContaining({ actionCount: 1 }));
  });

  it('should block on an extension at the attempt past the limit, ending exhausted when denied', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(Array.from({ length: 11 }, () => 'lookup_fixture'))));
    const outcome = await run();
    expect(outcome.status).toBe('budget_exhausted');
    expect(toolExecutor.execute).toHaveBeenCalledTimes(10);
    expect(approvalsService.request).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadText: expect.stringContaining('extension 1; 10 attempts so far'),
        toolName: 'extend_budget'
      })
    );
    expect(sends.at(-1)?.text).toContain('action attempts');
  });

  // §5.3 — "stop and tell me what you have" must get that, not a notice saying the budget ran out
  it('should end the actions but not the voice when an extension is denied with a reason', async () => {
    approvalsService.request.mockResolvedValueOnce(
      Result.ok({ byUsername: 'casey', kind: 'denied-with-reason', reason: 'stop and summarise' })
    );
    complete.mockResolvedValueOnce(Result.ok(toolUse(Array.from({ length: 11 }, () => 'lookup_fixture'))));
    complete.mockResolvedValueOnce(Result.ok(text('here is what I have')));
    const outcome = await run();
    expect(outcome.status).toBe('completed');
    expect(toolExecutor.execute).toHaveBeenCalledTimes(10);
    const finalRequest = complete.mock.calls[1]![0];
    expect(finalRequest.messages.at(-1)?.content).toContain('stop and summarise');
    expect(sends.at(-1)?.text).toBe('here is what I have');
  });

  it('should end a turn that calls a tool after a reasoned denial, without prompting twice', async () => {
    approvalsService.request.mockResolvedValueOnce(
      Result.ok({ byUsername: 'casey', kind: 'denied-with-reason', reason: 'stop and summarise' })
    );
    complete.mockResolvedValueOnce(Result.ok(toolUse(Array.from({ length: 11 }, () => 'lookup_fixture'))));
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    const outcome = await run();
    expect(outcome.status).toBe('budget_exhausted');
    expect(approvalsService.request).toHaveBeenCalledOnce();
    expect(toolExecutor.execute).toHaveBeenCalledTimes(10);
  });

  it('should grant ten further attempts against the accumulated context when the extension is approved', async () => {
    approvalsService.request.mockResolvedValueOnce(Result.ok({ byUsername: 'casey', kind: 'approved' }));
    complete.mockResolvedValueOnce(Result.ok(toolUse(Array.from({ length: 11 }, () => 'lookup_fixture'))));
    complete.mockResolvedValueOnce(Result.ok(text('finished after the extension')));
    const outcome = await run();
    expect(outcome.status).toBe('completed');
    expect(toolExecutor.execute).toHaveBeenCalledTimes(11);
    const finalRequest = complete.mock.calls[1]![0];
    expect(finalRequest.messages.filter((message) => message.role === 'tool')).toHaveLength(11);
    expect(turnsService.close).toHaveBeenCalledWith(
      'turn-1',
      'completed',
      expect.objectContaining({ actionCount: 11 })
    );
  });

  it('should end the turn and post the error under the agent’s name on a semantic tool failure', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    toolExecutor.execute.mockResolvedValue({
      detail: 'no tool named "send_mail" exists',
      kind: 'terminal',
      status: 'semantic_error'
    } satisfies ToolAttempt);
    const outcome = await run();
    expect(outcome.status).toBe('semantic_error');
    expect(sends.at(-1)?.text).toContain('no tool named "send_mail" exists');
  });

  it('should state that completion cannot be confirmed when a mutating call times out', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['write_fixture'])));
    toolExecutor.execute.mockResolvedValue({
      detail: 'write_fixture timed out',
      kind: 'terminal',
      status: 'side_effect_ambiguous'
    } satisfies ToolAttempt);
    const outcome = await run();
    expect(outcome.status).toBe('side_effect_ambiguous');
    expect(sends.at(-1)?.text).toContain('cannot confirm');
  });

  it('should end the turn as provider_outage once transport retries are exhausted, spending nothing', async () => {
    complete.mockResolvedValueOnce(Result.err({ kind: 'transport' } satisfies InferenceFailure.Transport));
    const outcome = await run();
    expect(outcome.status).toBe('provider_outage');
    expect(sends.at(-1)?.text).toContain('provider');
    expect(turnsService.close).toHaveBeenCalledWith(
      'turn-1',
      'provider_outage',
      expect.objectContaining({ actionCount: 0 })
    );
  });

  it('should reject output mentioning two agents as a user message and continue the turn (§4.5)', async () => {
    multiMentionPolicy.refuses.mockReturnValueOnce(true);
    complete.mockResolvedValueOnce(Result.ok(text('@owen and @tess, split this')));
    complete.mockResolvedValueOnce(Result.ok(text('@owen, please take this')));
    const outcome = await run();
    expect(outcome.status).toBe('completed');
    expect(sends.map((send) => send.text)).toStrictEqual(['@owen, please take this']);
    const retryRequest = complete.mock.calls[1]![0];
    expect(retryRequest.messages.at(-1)).toStrictEqual({
      content: 'post rejected: multiple agent mentions',
      role: 'user'
    });
  });

  it('should end the turn as semantic_error on malformed model output, never feeding it back', async () => {
    complete.mockResolvedValueOnce(
      Result.err({ kind: 'malformed', message: 'bad json' } satisfies InferenceFailure.Malformed)
    );
    const outcome = await run();
    expect(outcome.status).toBe('semantic_error');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('should count an invocation denied before execution as one attempt and ask how to proceed', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['gated_fixture'])));
    toolExecutor.execute.mockResolvedValue({
      detail: '@casey denied gated_fixture',
      kind: 'terminal',
      status: 'denied'
    } satisfies ToolAttempt);
    const outcome = await run();
    expect(outcome.status).toBe('denied');
    expect(turnsService.close).toHaveBeenCalledWith('turn-1', 'denied', expect.objectContaining({ actionCount: 1 }));
    expect(sends.at(-1)?.text).toContain('How would you like me to proceed');
  });

  it('should close as stopped at the next boundary after /stop, posting nothing further', async () => {
    complete.mockImplementationOnce(() => {
      turnControlRegistry.abortChannel('channel-1', 'stopped');
      return Promise.resolve(Result.ok(text('discarded output')));
    });
    const outcome = await run();
    expect(outcome.status).toBe('stopped');
    expect(sends).toHaveLength(0);
    expect(statusHandle.close).toHaveBeenCalledWith('stopped');
  });

  it('should return killed immediately while a completion is still in flight', async () => {
    complete.mockImplementationOnce(() => new Promise(() => undefined));
    const running = run();
    await new Promise((resolve) => setImmediate(resolve));
    turnControlRegistry.abortChannel('channel-1', 'killed');
    const outcome = await running;
    expect(outcome.status).toBe('killed');
    expect(sends).toHaveLength(0);
  });

  it('should close without any follow-up post under a cancelling command (§7.5)', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['gated_fixture'])));
    toolExecutor.execute.mockResolvedValue({
      detail: 'the pending approval was cancelled by stop',
      kind: 'terminal',
      status: 'stopped'
    } satisfies ToolAttempt);
    const outcome = await run();
    expect(outcome.status).toBe('stopped');
    expect(sends).toHaveLength(0);
  });

  it('should close the turn rather than leave it running when the framework itself throws', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    turnsService.appendEvent.mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    const outcome = await run();
    expect(outcome.status).toBe('semantic_error');
    expect(statusHandle.close).toHaveBeenCalledWith('semantic_error');
    expect(turnsService.close).toHaveBeenCalledWith('turn-1', 'semantic_error', expect.anything());
    expect(sends.at(-1)?.text).toContain('framework');
  });

  it('should dispose the turn’s browsing session when the turn completes', async () => {
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await run();
    expect(webService.endTurn).toHaveBeenCalledExactlyOnceWith('turn-1');
  });

  it('should dispose the browsing session even when the framework itself throws', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    turnsService.appendEvent.mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    await run();
    expect(webService.endTurn).toHaveBeenCalledExactlyOnceWith('turn-1');
  });

  it('should close as an outage rather than completed when the final output cannot be posted', async () => {
    complete.mockResolvedValueOnce(Result.ok(text('lost reply')));
    transportSend.mockResolvedValueOnce(Result.err({ kind: 'api', message: 'mattermost is down' }));
    const outcome = await run();
    expect(outcome.status).toBe('provider_outage');
    expect(conversationsService.record).not.toHaveBeenCalled();
    expect(turnsService.appendEvent).toHaveBeenCalledWith('turn-1', {
      content: 'lost reply',
      kind: 'assistant_message',
      toolCalls: []
    });
  });

  it('should still return the outcome when both closing writes fail', async () => {
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    statusHandle.close.mockRejectedValueOnce(new Error('the status post is gone'));
    turnsService.close.mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    expect(await run()).toStrictEqual({ status: 'completed', turnId: 'turn-1' });
  });

  it('should log, not throw, when disposing the browsing session fails', async () => {
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    webService.endTurn.mockRejectedValueOnce(new Error('the browser is wedged'));
    expect(await run()).toStrictEqual({ status: 'completed', turnId: 'turn-1' });
    expect(loggingService.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'failed to dispose the browsing session' })
    );
  });

  it('should log why inference failed, so a rejected request is diagnosable from the logs', async () => {
    complete.mockResolvedValueOnce(
      Result.err({ kind: 'provider', message: 'deepseek responded with status 400: invalid schema', status: 400 })
    );
    await run();
    expect(loggingService.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('invalid schema') })
    );
  });

  it('should say the provider rejected the request, rather than blaming reachability', async () => {
    complete.mockResolvedValueOnce(
      Result.err({ kind: 'provider', message: 'deepseek responded with status 400: invalid schema', status: 400 })
    );
    await run();
    expect(sends.at(-1)?.text).toContain('rejected');
  });

  it('should end the turn as an outage when a tool exhausts its transport retries', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    toolExecutor.execute.mockResolvedValue({
      detail: 'the approval prompt could not be posted',
      kind: 'terminal',
      status: 'provider_outage'
    } satisfies ToolAttempt);
    const outcome = await run();
    expect(outcome.status).toBe('provider_outage');
    expect(sends.at(-1)?.text).toContain('Failed to reach the model provider');
  });

  it('should disclose a memory write and its eviction in the trace and the turn events (§3.6)', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['write_memory'])));
    complete.mockResolvedValueOnce(Result.ok(text('saved')));
    toolExecutor.execute.mockImplementationOnce(async ({ turn }) => {
      await turn.discloseMemoryWrite({
        body: 'casey prefers pnpm',
        description: 'tooling preference',
        evictedDescriptions: ['an ancient note'],
        memoryId: 'memory-1'
      });
      return { kind: 'continue', output: 'ok' };
    });
    await run();
    expect(turnsService.appendEvent).toHaveBeenCalledWith(
      'turn-1',
      expect.objectContaining({ kind: 'memory_written', memoryId: 'memory-1' })
    );
    expect(statusHandle.appendTrace).toHaveBeenCalledWith('📝 _saved memory: tooling preference — casey prefers pnpm_');
    expect(statusHandle.appendTrace).toHaveBeenCalledWith(
      '♻️ _evicted the oldest memory to make room: an ancient note_'
    );
  });

  it('should thread the turn’s own event appender into tool execution and approval requests', async () => {
    toolExecutor.execute.mockImplementation(async ({ appendEvent }) => {
      await appendEvent({ content: 'from the tool', kind: 'assistant_message', toolCalls: [] });
      return { kind: 'continue', output: 'ok' };
    });
    approvalsService.request.mockImplementationOnce(async ({ appendEvent }) => {
      await appendEvent({ content: 'from the approval', kind: 'assistant_message', toolCalls: [] });
      return Result.ok({ byUsername: 'casey', kind: 'denied' });
    });
    complete.mockResolvedValueOnce(Result.ok(toolUse(Array.from({ length: 11 }, () => 'lookup_fixture'))));
    await run();
    const contents = turnsService.appendEvent.mock.calls.map(([, event]: any) => event.content);
    expect(contents).toContain('from the tool');
    expect(contents).toContain('from the approval');
  });

  it('should abandon the rest of a completion’s tool batch once /stop lands mid-batch (§7.5)', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture', 'lookup_fixture'])));
    toolExecutor.execute.mockImplementationOnce(() => {
      turnControlRegistry.abortChannel('channel-1', 'stopped');
      return Promise.resolve({ kind: 'continue', output: 'ok' } satisfies ToolAttempt);
    });
    const outcome = await run();
    expect(outcome.status).toBe('stopped');
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it('should return killed while a tool call is still in flight', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    toolExecutor.execute.mockImplementationOnce(() => new Promise(() => undefined));
    const running = run();
    await new Promise((resolve) => setImmediate(resolve));
    turnControlRegistry.abortChannel('channel-1', 'killed');
    expect((await running).status).toBe('killed');
    expect(statusHandle.close).toHaveBeenCalledWith('killed');
  });

  it('should end the turn as an outage when the extension prompt cannot be delivered', async () => {
    approvalsService.request.mockResolvedValueOnce(
      Result.err({ kind: 'prompt-undeliverable', message: 'mattermost is down' })
    );
    complete.mockResolvedValueOnce(Result.ok(toolUse(Array.from({ length: 11 }, () => 'lookup_fixture'))));
    const outcome = await run();
    expect(outcome.status).toBe('provider_outage');
    expect(sends).toHaveLength(0);
  });

  it('should close under the status a cancelled extension implies, posting nothing (§7.5)', async () => {
    const statuses: string[] = [];
    for (const reason of ['halt', 'kill', 'restart', 'stop'] as const) {
      approvalsService.request.mockResolvedValueOnce(Result.ok({ kind: 'cancelled', reason }));
      complete.mockResolvedValueOnce(Result.ok(toolUse(Array.from({ length: 11 }, () => 'lookup_fixture'))));
      statuses.push((await run()).status);
    }
    expect(statuses).toStrictEqual(['halted', 'killed', 'halted', 'stopped']);
    expect(sends).toHaveLength(0);
  });

  it('should close as stopped rather than ask to extend when /stop lands at the budget ceiling', async () => {
    multiMentionPolicy.refuses.mockImplementationOnce(() => {
      turnControlRegistry.abortChannel('channel-1', 'stopped');
      return true;
    });
    complete.mockResolvedValueOnce(Result.ok(toolUse(Array.from({ length: 10 }, () => 'lookup_fixture'))));
    complete.mockResolvedValueOnce(Result.ok(text('@owen and @tess, split this')));
    const outcome = await run();
    expect(outcome.status).toBe('stopped');
    expect(approvalsService.request).not.toHaveBeenCalled();
  });

  it('should charge a rejected post against the budget and retry once the extension is approved', async () => {
    approvalsService.request.mockResolvedValueOnce(Result.ok({ byUsername: 'casey', kind: 'approved' }));
    multiMentionPolicy.refuses.mockReturnValueOnce(true);
    complete.mockResolvedValueOnce(Result.ok(toolUse(Array.from({ length: 10 }, () => 'lookup_fixture'))));
    complete.mockResolvedValueOnce(Result.ok(text('@owen and @tess, split this')));
    complete.mockResolvedValueOnce(Result.ok(text('@owen, please take this')));
    const outcome = await run();
    expect(outcome.status).toBe('completed');
    expect(turnsService.close).toHaveBeenCalledWith(
      'turn-1',
      'completed',
      expect.objectContaining({ actionCount: 11 })
    );
  });

  it('should log and carry on when a turn notice cannot be posted', async () => {
    complete.mockResolvedValueOnce(Result.err({ kind: 'transport' } satisfies InferenceFailure.Transport));
    transportSend.mockResolvedValueOnce(Result.err({ kind: 'api', message: 'mattermost is down' }));
    const outcome = await run();
    expect(outcome.status).toBe('provider_outage');
    expect(conversationsService.record).not.toHaveBeenCalled();
  });

  it('should log and carry on when a posted notice cannot be recorded', async () => {
    complete.mockResolvedValueOnce(Result.err({ kind: 'transport' } satisfies InferenceFailure.Transport));
    conversationsService.record.mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    const outcome = await run();
    expect(outcome.status).toBe('provider_outage');
    expect(statusHandle.close).toHaveBeenCalledWith('provider_outage');
  });

  it('should accumulate reported token usage across every completion in the turn', async () => {
    complete.mockResolvedValueOnce(
      Result.ok(toolUse(['lookup_fixture'], '', { completionTokens: 2, promptTokens: 3 }))
    );
    complete.mockResolvedValueOnce(Result.ok(text('done', { completionTokens: 5, promptTokens: 7 })));
    await run();
    expect(turnsService.close).toHaveBeenCalledWith(
      'turn-1',
      'completed',
      expect.objectContaining({ usage: { completionTokens: 7, promptTokens: 10 } })
    );
  });

  it('should post no delegation-limit notice at depth ten when the output names no agent', async () => {
    complete.mockResolvedValueOnce(Result.ok(text('nothing to delegate')));
    const outcome = await turnRunner.run({ channelId: 'channel-1', depth: 10, profile: PROFILE });
    expect(outcome.status).toBe('completed');
    expect(sends.map((send) => send.text)).toStrictEqual(['nothing to delegate']);
  });
});
