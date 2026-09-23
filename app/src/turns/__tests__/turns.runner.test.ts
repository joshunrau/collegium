import { describeReplaySubject, renderDuplicateLine, renderSupersededLine } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import type { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConfigService } from '@/config/config.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import type { InferenceClient } from '@/inference/inference.client.ts';
import { InferenceRegistry } from '@/inference/inference.registry.ts';
import type {
  CompletionRequest,
  CompletionResult,
  CompletionUsage,
  InferenceFailure
} from '@/inference/inference.types.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolExecutor } from '@/tools/tools.executor.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';
import type { ToolAttempt } from '@/tools/tools.types.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';
import type { Trigger } from '@/triggers/triggers.types.ts';
import { WebService } from '@/web/web.service.ts';

import { ContextAssembler } from '../context/context.assembler.ts';
import { TurnControlRegistry } from '../control/turn-control.registry.ts';
import { TurnFoldRegistry } from '../folding/turn-fold.registry.ts';
import { StatusPostService } from '../status/status-post.service.ts';
import { TurnRunner } from '../turns.runner.ts';
import { TurnsService } from '../turns.service.ts';
import { TypingIndicatorService } from '../typing/typing-indicator.service.ts';

import type { HeldActivation, Turn } from '../turns.types.ts';

const PROFILE = {
  actionBudget: 10,
  contextBudgetTokens: 1000,
  expertise: 'testing',
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  personality: undefined,
  skills: [],
  systemPrompt: 'You are Mira.',
  tools: [],
  toolSettings: new Map(),
  turnContextCeilingTokens: 3_400,
  username: 'mira',
  workspaceDir: '/tmp/workspaces/mira'
} as AgentProfile;

const text = (content: string, usage?: CompletionUsage): CompletionResult => ({ content, kind: 'text', usage });

const toolUse = (names: string[], content = '', usage?: CompletionUsage): CompletionResult => ({
  content,
  kind: 'tool-use',
  toolCalls: names.map((name, index) => ({ arguments: {}, id: `call-${index}`, name })),
  usage
});

const UNPARSED_RESULT = 'the arguments to this call were not valid JSON, so the call did not run';

const unparsedCall = (name: string, rawArguments: string, id = 'call-0') => ({ id, name, rawArguments });

const unparsedUse = (calls: CompletionResult.ToolUse['toolCalls']): CompletionResult => ({
  content: '',
  kind: 'tool-use',
  toolCalls: calls,
  usage: undefined
});

describe('TurnRunner', () => {
  let approvalsService: MockedInstance<ApprovalsService>;
  let complete: Mock<InferenceClient['complete']>;
  let contextAssembler: MockedInstance<ContextAssembler>;
  let conversationsService: MockedInstance<ConversationsService>;
  let multiMentionPolicy: MockedInstance<MultiMentionPolicy>;
  let releaseHeldActivation: Mock<(held: HeldActivation) => void>;
  let sends: { channelId: string; text: string }[];
  let statusHandle: { appendTrace: any; close: any; markTrace: any; setTransient: any; surface: any };
  let tasksService: MockedInstance<TasksService>;
  let toolExecutor: MockedInstance<ToolExecutor>;
  let toolRegistry: MockedInstance<ToolRegistry>;
  let transportSend: Mock<(message: { channelId: string; text: string }) => Promise<unknown>>;
  let triggersService: MockedInstance<TriggersService>;
  let turnControlRegistry: TurnControlRegistry;
  let turnFoldRegistry: TurnFoldRegistry;
  let turnRunner: TurnRunner;
  let loggingService: MockedInstance<LoggingService>;
  let maxPostSizeChars: Mock<ChatTransport['maxPostSizeChars']>;
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
      appendTrace: vi.fn().mockReturnValue(0),
      close: vi.fn().mockResolvedValue(undefined),
      markTrace: vi.fn(),
      setTransient: vi.fn().mockResolvedValue(undefined),
      surface: vi.fn().mockResolvedValue(true)
    };
    contextAssembler = MockFactory.createMock(ContextAssembler);
    contextAssembler.assemble.mockResolvedValue({
      assembledAt: new Date(0),
      reachesBackTo: new Date('2026-09-21T12:00:00Z'),
      request: {
        cacheKey: 'mira:channel-1',
        messages: [{ content: '@casey: hi', role: 'user' }],
        model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
        systemPrompt: 'sys',
        tools: []
      },
      windowPostIds: new Set(['post-0'])
    });
    const inferenceRegistry = MockFactory.createMock(InferenceRegistry);
    inferenceRegistry.getClientForModel.mockReturnValue({ complete });
    tasksService = MockFactory.createMock(TasksService);
    tasksService.prepareExhaustionReport.mockResolvedValue(undefined);
    multiMentionPolicy = MockFactory.createMock(MultiMentionPolicy);
    multiMentionPolicy.addresseesOf.mockReturnValue([]);
    multiMentionPolicy.refuses.mockReturnValue(false);
    multiMentionPolicy.refusesSecondAddressee.mockReturnValue(false);
    multiMentionPolicy.stripAgentMentionsExcept.mockImplementation((text: string) => text);
    multiMentionPolicy.stripAgentMentions.mockImplementation((content) => content);
    releaseHeldActivation = vi.fn<(held: HeldActivation) => void>();
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
    maxPostSizeChars = vi.fn().mockResolvedValue(Result.ok(16_383));
    transportRegistry.get.mockReturnValue({ maxPostSizeChars, send: transportSend } as unknown as ChatTransport);
    triggersService = MockFactory.createMock(TriggersService);
    triggersService.findAnnouncedBy.mockResolvedValue(undefined);
    typingHandle = { stop: vi.fn() };
    typingIndicatorService = MockFactory.createMock(TypingIndicatorService);
    typingIndicatorService.start.mockReturnValue(typingHandle);
    webService = MockFactory.createMock(WebService);
    turnsService = MockFactory.createMock(TurnsService);
    turnsService.countInChain.mockResolvedValue(1);
    turnsService.open.mockResolvedValue(Result.ok({ id: 'turn-1' } as Turn));
    turnsService.appendEvent.mockResolvedValue(undefined);
    turnsService.close.mockResolvedValue(undefined);
    turnsService.recordStatusPost.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        TurnRunner,
        TurnControlRegistry,
        TurnFoldRegistry,
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: ConfigService, useValue: createConfigServiceMock({ turns: { chainLengthLimit: 3 } }) },
        { provide: ContextAssembler, useValue: contextAssembler },
        { provide: ConversationsService, useValue: conversationsService },
        DateFormatter,
        { provide: InferenceRegistry, useValue: inferenceRegistry },
        MockFactory.createForService(LoggingService),
        { provide: MultiMentionPolicy, useValue: multiMentionPolicy },
        { provide: StatusPostService, useValue: statusPostService },
        { provide: TasksService, useValue: tasksService },
        { provide: ToolExecutor, useValue: toolExecutor },
        { provide: ToolRegistry, useValue: toolRegistry },
        { provide: TransportRegistry, useValue: transportRegistry },
        { provide: TriggersService, useValue: triggersService },
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

  const run = async () => {
    const outcome = await turnRunner.run({
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      profile: PROFILE,
      releaseHeldActivation,
      rootPostId: 'post-0'
    });
    return outcome.unwrap();
  };

  const runFolding = async () => {
    const outcome = await turnRunner.run({
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      foldAuthorUsername: 'casey',
      profile: PROFILE,
      releaseHeldActivation,
      rootPostId: 'post-0'
    });
    return outcome.unwrap();
  };

  const offerFragment = (postId: string): boolean => {
    return turnFoldRegistry.offer({ agentUsername: 'mira', authorUsername: 'casey', channelId: 'channel-1', postId });
  };

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
    complete.mockResolvedValueOnce(
      Result.err({ kind: 'transport', reason: 'unknown' } satisfies InferenceFailure.Transport)
    );
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
      { kind: 'reply', turnId: 'turn-1' }
    );
    expect(statusHandle.close).toHaveBeenCalledWith('completed', undefined);
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

  it('should quote the newest fragment on the approval prompt after a fold, and trace the fold (§3.7, §4.4)', async () => {
    conversationsService.findRequester.mockImplementation((postId: string) => {
      return Promise.resolve({ kind: 'human' as const, message: `request in ${postId}`, username: 'casey' });
    });
    complete.mockImplementationOnce(() => {
      offerFragment('post-2');
      offerFragment('post-3');
      return Promise.resolve(Result.ok(text('answering half a question')));
    });
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await turnRunner.run({
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      foldAuthorUsername: 'casey',
      profile: PROFILE,
      releaseHeldActivation,
      rootPostId: 'post-1',
      triggeringPostId: 'post-1'
    });
    expect(toolExecutor.execute.mock.calls[0]?.[0].contextText).toBe(
      'Action 1 of 10 · requested by @casey: "request in post-3"'
    );
    expect(statusHandle.appendTrace).toHaveBeenCalledWith({
      kind: 'note',
      text: '↺ _started over to read a further post_'
    });
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
    const outcome = (
      await turnRunner.run({
        chainLength: 1,
        channelId: 'channel-1',
        depth: 10,
        profile: PROFILE,
        releaseHeldActivation,
        rootPostId: 'post-0'
      })
    ).unwrap();
    expect(outcome.status).toBe('completed');
    expect(sends.map((send) => send.text)).toStrictEqual([
      "I would have asked a colleague but I've reached the delegation limit — someone needs to pick this up.",
      'please continue'
    ]);
  });

  it('should strip agent mentions and post the chain-length notice when the chain count reaches the limit (§7.4)', async () => {
    turnsService.countInChain.mockResolvedValue(3);
    multiMentionPolicy.stripAgentMentions.mockImplementation((content: string) => content.replace('@owen ', ''));
    complete.mockResolvedValueOnce(Result.ok(text('@owen please continue')));
    const outcome = (
      await turnRunner.run({
        chainLength: 3,
        channelId: 'channel-1',
        depth: 1,
        profile: PROFILE,
        releaseHeldActivation,
        rootPostId: 'post-0'
      })
    ).unwrap();
    expect(outcome.status).toBe('completed');
    expect(sends.map((send) => send.text)).toStrictEqual([
      'I would have continued with a colleague but this chain has reached its limit — someone needs to say whether to go on.',
      'please continue'
    ]);
  });

  it('should name the chain limit rather than the depth limit when both are reached', async () => {
    turnsService.countInChain.mockResolvedValue(3);
    multiMentionPolicy.stripAgentMentions.mockImplementation((content: string) => content.replace('@owen ', ''));
    complete.mockResolvedValueOnce(Result.ok(text('@owen please continue')));
    await turnRunner.run({
      chainLength: 3,
      channelId: 'channel-1',
      depth: 10,
      profile: PROFILE,
      releaseHeldActivation,
      rootPostId: 'post-0'
    });
    expect(sends[0]?.text).toContain('this chain has reached its limit');
  });

  it('should return the admission refusal without opening a status post or calling the provider (§7.4)', async () => {
    turnsService.open.mockResolvedValueOnce(
      Result.err({ count: 3, kind: 'chain-full', limit: 3, rootPostId: 'post-0' })
    );
    const outcome = await turnRunner.run({
      chainLength: 4,
      channelId: 'channel-1',
      depth: 0,
      profile: PROFILE,
      releaseHeldActivation,
      rootPostId: 'post-0'
    });
    expect(outcome.success).toBe(false);
    expect(complete).not.toHaveBeenCalled();
    expect(statusHandle.close).not.toHaveBeenCalled();
    expect(webService.endTurn).not.toHaveBeenCalled();
  });

  it('should run the budget the agent’s own profile states (§5.3)', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(Array.from({ length: 4 }, () => 'lookup_fixture'))));
    const outcome = (
      await turnRunner.run({
        chainLength: 1,
        channelId: 'channel-1',
        depth: 0,
        profile: { ...PROFILE, actionBudget: 3 },
        releaseHeldActivation,
        rootPostId: 'post-0'
      })
    ).unwrap();
    expect(outcome.status).toBe('budget_exhausted');
    expect(toolExecutor.execute).toHaveBeenCalledTimes(3);
    expect(approvalsService.request).toHaveBeenCalledWith(
      expect.objectContaining({ payloadText: expect.stringContaining('extension 1; 3 attempts so far') })
    );
  });

  it('should tell every approval prompt where in the budget it sits and which human asked (§3.7)', async () => {
    conversationsService.findRequester.mockResolvedValue({ kind: 'human', message: 'ship it', username: 'casey' });
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture', 'lookup_fixture'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await turnRunner.run({
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      profile: PROFILE,
      releaseHeldActivation,
      rootPostId: 'post-1',
      triggeringPostId: 'post-1'
    });
    expect(toolExecutor.execute.mock.calls.map(([input]: any) => input.contextText)).toStrictEqual([
      'Action 1 of 10 · requested by @casey: "ship it"',
      'Action 2 of 10 · requested by @casey: "ship it"'
    ]);
    expect(conversationsService.findRequester).toHaveBeenCalledExactlyOnceWith('post-1');
  });

  it('should say a trigger raised the turn when no human post started it (§3.7)', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await run();
    expect(toolExecutor.execute.mock.calls[0]?.[0].contextText).toBe(
      'Action 1 of 10 · raised by a trigger, not by a person'
    );
    expect(conversationsService.findRequester).not.toHaveBeenCalled();
  });

  it('should name the trigger a system post announced on the approval prompt (§3.7)', async () => {
    conversationsService.findRequester.mockResolvedValue({ kind: 'system' });
    triggersService.findAnnouncedBy.mockResolvedValue({ reference: { id: '1:12' }, source: 'mail' } as Trigger);
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await turnRunner.run({
      chainLength: 1,
      channelId: 'channel-1',
      depth: 1,
      profile: PROFILE,
      releaseHeldActivation,
      rootPostId: 'announcement-1',
      triggeringPostId: 'announcement-1'
    });
    expect(toolExecutor.execute.mock.calls[0]?.[0].contextText).toBe(
      'Action 1 of 10 · raised by a mail trigger (⟨1:12⟩), not by a person'
    );
  });

  it('should strip agent mentions from the words of the person a colleague relays (§4.5)', async () => {
    multiMentionPolicy.stripAgentMentions.mockImplementation((content: string) => content.replaceAll('@', ''));
    conversationsService.findRequester.mockResolvedValue({
      kind: 'agent',
      onBehalfOf: { kind: 'human', message: '@owen ask @mira to run it', username: 'casey' },
      username: 'owen'
    });
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await turnRunner.run({
      chainLength: 2,
      channelId: 'channel-1',
      depth: 1,
      profile: PROFILE,
      releaseHeldActivation,
      rootPostId: 'post-1',
      triggeringPostId: 'post-2'
    });
    expect(toolExecutor.execute.mock.calls[0]?.[0].contextText).toBe(
      'Action 1 of 10 · asked by colleague owen, for @casey: "owen ask mira to run it"'
    );
  });

  it('should execute tools, record the trace, and loop until the model emits text', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'], 'checking')));
    complete.mockResolvedValueOnce(Result.ok(text('found it')));
    const outcome = await run();
    expect(outcome.status).toBe('completed');
    expect(turnsService.appendEvent.mock.calls.map(([, event]: any) => event.kind)).toStrictEqual([
      'assistant_message',
      'tool_result',
      'assistant_message'
    ]);
    const secondRequest = complete.mock.calls[1]![0];
    expect(secondRequest.messages.map((message: { role: string }) => message.role)).toStrictEqual([
      'user',
      'assistant',
      'tool'
    ]);
    expect(statusHandle.setTransient).toHaveBeenCalledWith('checking');
    expect(statusHandle.appendTrace).toHaveBeenCalledWith({
      detail: undefined,
      effect: undefined,
      kind: 'call',
      toolName: 'lookup_fixture'
    });
    expect(turnsService.close).toHaveBeenCalledWith('turn-1', 'completed', expect.objectContaining({ actionCount: 1 }));
  });

  it('should record the replay text a tool hands back beside its result, feeding the model the result itself', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['skills__load'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    toolExecutor.execute.mockResolvedValueOnce({ kind: 'continue', output: '# The skill', replay: '[loaded skill x]' });
    await run();
    expect(turnsService.appendEvent).toHaveBeenCalledWith(
      'turn-1',
      expect.objectContaining({ kind: 'tool_result', output: '# The skill', replay: '[loaded skill x]' })
    );
    expect(complete.mock.calls[1]![0].messages.at(-1)).toStrictEqual({
      content: '# The skill',
      role: 'tool',
      toolCallId: 'call-0'
    });
  });

  it('should trace a call by its display name with the detail the tool renders', async () => {
    toolRegistry.describeCall.mockReturnValue({
      detail: 'https://northmoor.example/',
      displayName: 'web::navigate',
      effect: undefined,
      id: ['web', 'navigate']
    });
    complete.mockResolvedValueOnce(Result.ok(toolUse(['web__navigate'])));
    complete.mockResolvedValueOnce(Result.ok(text('found it')));
    await run();
    expect(toolRegistry.describeCall).toHaveBeenCalledWith({
      args: {},
      name: 'web__navigate',
      profile: PROFILE
    });
    expect(statusHandle.appendTrace).toHaveBeenCalledWith({
      detail: 'https://northmoor.example/',
      effect: undefined,
      kind: 'call',
      toolName: 'web::navigate'
    });
  });

  it('should not count a budget-exempt call against the budget (§5.3)', async () => {
    toolRegistry.isBudgetExempt.mockImplementation((_profile, name: string) => name !== 'lookup_fixture');
    complete.mockResolvedValueOnce(Result.ok(toolUse(['skills__load', 'memory__read', 'lookup_fixture'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await run();
    expect(turnsService.close).toHaveBeenCalledWith('turn-1', 'completed', expect.objectContaining({ actionCount: 1 }));
  });

  it('should mark a reasoned denial on its own trace line (§8.1)', async () => {
    statusHandle.appendTrace.mockReturnValueOnce(7);
    toolExecutor.execute.mockResolvedValueOnce({
      kind: 'continue',
      output: 'denied: use another name',
      traceMark: { ran: false, text: '🛑 denied by @casey' }
    });
    complete.mockResolvedValueOnce(Result.ok(toolUse(['write_file'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await run();
    expect(statusHandle.markTrace).toHaveBeenCalledExactlyOnceWith(7, { ran: false, text: '🛑 denied by @casey' });
  });

  it('should mark a line with what the tool says the call came to (§8.1)', async () => {
    toolExecutor.execute.mockResolvedValueOnce({ kind: 'continue', output: 'page', traceOutcome: 'HTTP 404' });
    complete.mockResolvedValueOnce(Result.ok(toolUse(['web__fetch'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await run();
    expect(statusHandle.markTrace).toHaveBeenCalledExactlyOnceWith(0, { ran: true, text: 'HTTP 404' });
  });

  it('should name the most repeated calls and the agent’s last words in an extension prompt (§5.3)', async () => {
    toolRegistry.describeCall.mockImplementation(({ name }: { name: string }) => ({
      detail: name === 'lookup_fixture' ? 'https://x.example/page-2' : undefined,
      displayName: name,
      effect: undefined,
      id: ['fixture', name]
    }));
    complete.mockResolvedValueOnce(
      Result.ok(
        toolUse([...Array.from({ length: 9 }, () => 'lookup_fixture'), 'other_fixture'], 'collecting the roster')
      )
    );
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    await run();
    expect(approvalsService.request).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadText: [
          'I have used all my action attempts and would like to keep going. This would be extension 1; 10 attempts so far. Approving grants another 10.',
          'Most repeated so far: `lookup_fixture https://x.example/page-2` ×9',
          'What I still need: "collecting the roster"'
        ].join('\n')
      })
    );
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
    complete.mockResolvedValueOnce(
      Result.err({ kind: 'transport', reason: 'unknown' } satisfies InferenceFailure.Transport)
    );
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

  it('should reject a tool call written as text and retry, posting the real answer (§3.3)', async () => {
    complete.mockResolvedValueOnce(Result.ok(text('[called triggers__resolve({"id":"s8a15c97"})]')));
    complete.mockResolvedValueOnce(Result.ok(toolUse(['triggers__resolve'])));
    complete.mockResolvedValueOnce(Result.ok(text('resolved')));
    const outcome = await run();
    expect(outcome.status).toBe('completed');
    expect(sends.map((send) => send.text)).toStrictEqual(['resolved']);
    expect(complete.mock.calls[1]![0].messages[2]).toStrictEqual({
      content: 'post rejected: a tool call written as text runs nothing — invoke the tool instead',
      role: 'user'
    });
  });

  it('should reject a bare call object a provider left as text, rather than post it (§4.5)', async () => {
    complete.mockResolvedValueOnce(Result.ok(text('{"name":"triggers__resolve","arguments":{"id":"s8a15c97"}}')));
    complete.mockResolvedValueOnce(Result.ok(text('resolved')));
    const outcome = await run();
    expect(outcome.status).toBe('completed');
    expect(sends.map((send) => send.text)).toStrictEqual(['resolved']);
    expect(complete.mock.calls[1]![0].messages.at(-1)).toStrictEqual({
      content: 'post rejected: a tool call written as text runs nothing — invoke the tool instead',
      role: 'user'
    });
  });

  it('should replay reasoning with the tool call it produced and keep it on the event, never in a post (§3.12)', async () => {
    complete.mockResolvedValueOnce(
      Result.ok({ ...toolUse(['write_file']), reasoningContent: 'private thoughts' } satisfies CompletionResult)
    );
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await run();
    const followUp = complete.mock.calls[1]![0].messages;
    expect(followUp.at(-2)).toMatchObject({ reasoningContent: 'private thoughts', role: 'assistant' });
    expect(turnsService.appendEvent.mock.calls[0]![1]).toMatchObject({
      kind: 'assistant_message',
      reasoningContent: 'private thoughts'
    });
    expect(JSON.stringify(sends)).not.toContain('private thoughts');
  });

  it('should record the final completion as an assistant_message event with its reasoning', async () => {
    complete.mockResolvedValueOnce(Result.ok({ ...text('done'), reasoningContent: 'that settles it' }));
    await run();
    expect(turnsService.appendEvent).toHaveBeenCalledWith('turn-1', {
      content: 'done',
      kind: 'assistant_message',
      reasoningContent: 'that settles it',
      toolCalls: []
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

  describe('a call naming no tool the agent holds (§7.2)', () => {
    const UNKNOWN: ToolAttempt = {
      kind: 'unknown-tool',
      output: 'no tool named "ghost" exists; the tools you can call are: a__b'
    };

    it('should answer it with the tools the agent can call and continue, spending an attempt', async () => {
      toolExecutor.execute.mockResolvedValueOnce(UNKNOWN);
      complete.mockResolvedValueOnce(Result.ok(toolUse(['ghost'])));
      complete.mockResolvedValueOnce(Result.ok(text('done')));
      const outcome = await run();
      expect(outcome.status).toBe('completed');
      expect(complete.mock.calls[1]![0].messages.at(-1)).toStrictEqual({
        content: UNKNOWN.output,
        role: 'tool',
        toolCallId: 'call-0'
      });
      expect(turnsService.close).toHaveBeenCalledWith(
        'turn-1',
        'completed',
        expect.objectContaining({ actionCount: 1 })
      );
    });

    it('should end the turn on the third in a row, as refused output does (§4.5)', async () => {
      toolExecutor.execute.mockResolvedValue(UNKNOWN);
      complete.mockResolvedValue(Result.ok(toolUse(['ghost'])));
      const outcome = await run();
      expect(outcome.status).toBe('semantic_error');
      expect(complete).toHaveBeenCalledTimes(3);
      expect(sends.map((send) => send.text)).toStrictEqual([
        'I could not produce a reply the framework would accept and stopped. The reason is in the trace.'
      ]);
    });
  });

  describe('a tool call whose arguments never parsed (§7.2)', () => {
    const grant = () => {
      toolRegistry.describeCall.mockReturnValue({
        detail: undefined,
        displayName: 'workspace::write',
        effect: undefined,
        id: ['workspace', 'write']
      });
    };

    it('should forgive one such call for a granted tool, spending an attempt and running nothing', async () => {
      grant();
      complete.mockResolvedValueOnce(
        Result.ok(unparsedUse([unparsedCall('workspace__write', '{"content": "unterminated')]))
      );
      complete.mockResolvedValueOnce(Result.ok(text('done')));
      const outcome = await run();
      expect(outcome.status).toBe('completed');
      expect(toolExecutor.execute).not.toHaveBeenCalled();
      expect(statusHandle.appendTrace).toHaveBeenCalledWith({
        detail: undefined,
        effect: undefined,
        kind: 'call',
        toolName: 'workspace::write'
      });
      expect(turnsService.close).toHaveBeenCalledWith(
        'turn-1',
        'completed',
        expect.objectContaining({ actionCount: 1 })
      );
      const followUp = complete.mock.calls[1]![0].messages;
      expect(followUp.at(-1)).toStrictEqual({ content: UNPARSED_RESULT, role: 'tool', toolCallId: 'call-0' });
      expect(JSON.stringify(followUp)).not.toContain('unterminated');
    });

    it('should keep at most two hundred characters of the raw text, on the trace event alone', async () => {
      grant();
      const raw = `{"content": "${'x'.repeat(300)}`;
      complete.mockResolvedValueOnce(Result.ok(unparsedUse([unparsedCall('workspace__write', raw)])));
      complete.mockResolvedValueOnce(Result.ok(text('done')));
      await run();
      expect(turnsService.appendEvent).toHaveBeenCalledWith(
        'turn-1',
        expect.objectContaining({
          kind: 'tool_result',
          output: UNPARSED_RESULT,
          rawArgumentsPreview: raw.slice(0, 200)
        })
      );
      expect(turnsService.appendEvent).toHaveBeenCalledWith(
        'turn-1',
        expect.objectContaining({ kind: 'assistant_message', toolCalls: [expect.objectContaining({ args: {} })] })
      );
    });

    it('should run the valid calls of a completion beside the forgiven one, never grouping them', async () => {
      grant();
      toolRegistry.isConcurrent.mockReturnValue(true);
      complete.mockResolvedValueOnce(
        Result.ok(
          unparsedUse([
            { arguments: {}, id: 'call-0', name: 'workspace__write' },
            unparsedCall('workspace__write', '{oops', 'call-1'),
            { arguments: {}, id: 'call-2', name: 'workspace__write' }
          ])
        )
      );
      complete.mockResolvedValueOnce(Result.ok(text('done')));
      await run();
      expect(toolExecutor.execute.mock.calls.map(([input]) => input.call.id)).toStrictEqual(['call-0', 'call-2']);
    });

    it('should end the turn on the second such call, saying so under its own name', async () => {
      grant();
      complete.mockResolvedValueOnce(Result.ok(unparsedUse([unparsedCall('workspace__write', '{oops')])));
      complete.mockResolvedValueOnce(Result.ok(unparsedUse([unparsedCall('workspace__write', '{oops again')])));
      const outcome = await run();
      expect(outcome.status).toBe('semantic_error');
      expect(complete).toHaveBeenCalledTimes(2);
      expect(sends.map((send) => send.text)).toStrictEqual([
        'I hit an internal error and stopped: a tool call I made could not be read'
      ]);
    });

    it('should answer such a call for a tool the agent does not hold as the unknown name it is', async () => {
      toolRegistry.renderUnknownToolResult.mockReturnValue('no tool named "does_not_exist" exists');
      complete.mockResolvedValueOnce(Result.ok(unparsedUse([unparsedCall('does_not_exist', '{oops')])));
      complete.mockResolvedValueOnce(Result.ok(text('done')));
      const outcome = await run();
      expect(outcome.status).toBe('completed');
      expect(toolExecutor.execute).not.toHaveBeenCalled();
      expect(complete.mock.calls[1]![0].messages.at(-1)).toStrictEqual({
        content: 'no tool named "does_not_exist" exists',
        role: 'tool',
        toolCallId: 'call-0'
      });
    });

    it('should ask for an extension before forgiving a call on an exhausted budget (§5.3)', async () => {
      grant();
      complete.mockResolvedValueOnce(Result.ok(unparsedUse([unparsedCall('workspace__write', '{oops')])));
      const outcome = (
        await turnRunner.run({
          chainLength: 1,
          channelId: 'channel-1',
          depth: 0,
          profile: { ...PROFILE, actionBudget: 0 },
          releaseHeldActivation,
          rootPostId: 'post-0'
        })
      ).unwrap();
      expect(approvalsService.request).toHaveBeenCalledOnce();
      expect(outcome.status).toBe('budget_exhausted');
    });
  });

  describe('steering (§7.5)', () => {
    const steer = (text = 'use staging') => {
      return turnControlRegistry.steerChannel('channel-1', { byUsername: 'casey', text });
    };

    it('should read a steer that arrived during a tool call before the next completion, as the human speaking', async () => {
      complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
      toolExecutor.execute.mockImplementationOnce(() => {
        steer();
        return Promise.resolve({ kind: 'continue', output: 'ok' } satisfies ToolAttempt);
      });
      complete.mockResolvedValueOnce(Result.ok(text('done')));
      const outcome = await run();
      expect(outcome.status).toBe('completed');
      expect(complete.mock.calls[1]![0].messages.at(-1)).toStrictEqual({
        content: 'casey (person): use staging',
        role: 'user'
      });
      expect(turnsService.appendEvent).toHaveBeenCalledWith('turn-1', {
        byUsername: 'casey',
        kind: 'steering_received',
        text: 'use staging'
      });
      expect(statusHandle.appendTrace).toHaveBeenCalledWith({ kind: 'note', text: '↩ _steered by @casey_' });
      expect(turnsService.close).toHaveBeenCalledWith(
        'turn-1',
        'completed',
        expect.objectContaining({ actionCount: 2 })
      );
    });

    it('should discard a completion made while a steer was in flight, running nothing and posting nothing of it', async () => {
      complete.mockImplementationOnce(() => {
        steer();
        return Promise.resolve(Result.ok(toolUse(['lookup_fixture'], 'premature')));
      });
      complete.mockImplementationOnce(() => {
        steer('and be brief');
        return Promise.resolve(Result.ok(text('premature answer')));
      });
      complete.mockResolvedValueOnce(Result.ok(text('corrected')));
      const outcome = await run();
      expect(outcome.status).toBe('completed');
      expect(toolExecutor.execute).not.toHaveBeenCalled();
      expect(sends.map((send) => send.text)).toStrictEqual(['corrected']);
      expect(turnsService.appendEvent.mock.calls.map(([, event]: any) => event.kind)).toStrictEqual([
        'steering_received',
        'steering_received',
        'assistant_message'
      ]);
    });

    it('should let a fold win over a steer and read the steer before the re-assembled completion (§4.4)', async () => {
      complete.mockImplementationOnce(() => {
        offerFragment('post-2');
        steer();
        return Promise.resolve(Result.ok(text('half')));
      });
      complete.mockResolvedValueOnce(Result.ok(text('all of it')));
      await runFolding();
      expect(contextAssembler.assemble).toHaveBeenCalledTimes(2);
      expect(complete.mock.calls[1]![0].messages.at(-1)).toStrictEqual({
        content: 'casey (person): use staging',
        role: 'user'
      });
      expect(sends.map((send) => send.text)).toStrictEqual(['all of it']);
    });

    it('should prompt for an extension when a steer exhausts the budget (§5.3)', async () => {
      complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
      toolExecutor.execute.mockImplementationOnce(() => {
        steer();
        return Promise.resolve({ kind: 'continue', output: 'ok' } satisfies ToolAttempt);
      });
      const outcome = (
        await turnRunner.run({
          chainLength: 1,
          channelId: 'channel-1',
          depth: 0,
          profile: { ...PROFILE, actionBudget: 1 },
          releaseHeldActivation,
          rootPostId: 'post-0'
        })
      ).unwrap();
      expect(approvalsService.request).toHaveBeenCalledOnce();
      expect(outcome.status).toBe('budget_exhausted');
    });
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
      turnControlRegistry.abortChannel('channel-1', 'stopped', 'casey');
      return Promise.resolve(Result.ok(text('discarded output')));
    });
    const outcome = await run();
    expect(outcome.status).toBe('stopped');
    expect(sends).toHaveLength(0);
    expect(statusHandle.close).toHaveBeenCalledWith('stopped', 'casey');
  });

  it('should record the usage of the completion a /stop discards (§8.2)', async () => {
    complete.mockImplementationOnce(() => {
      turnControlRegistry.abortChannel('channel-1', 'stopped', 'casey');
      return Promise.resolve(
        Result.ok(
          text('discarded output', {
            cachedPromptTokens: undefined,
            completionTokens: 2,
            costUsd: 0.25,
            promptTokens: 3,
            reasoningTokens: 1
          })
        )
      );
    });
    await run();
    expect(turnsService.close).toHaveBeenCalledWith(
      'turn-1',
      'stopped',
      expect.objectContaining({ usage: expect.objectContaining({ completionTokens: 2, promptTokens: 3 }) })
    );
  });

  it('should mark a call the command cancelled as one that did not run (§8.1)', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['gated_fixture'])));
    toolExecutor.execute.mockResolvedValue({
      detail: 'the pending approval was cancelled by stop',
      kind: 'terminal',
      status: 'stopped'
    } satisfies ToolAttempt);
    await run();
    expect(statusHandle.markTrace).toHaveBeenCalledWith(0, { ran: false, text: '⏹️ cancelled' });
  });

  it('should say how far back its context reached when the window missed the post it drained from (§5.2)', async () => {
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await turnRunner.run({
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      drainedFromPostId: 'post-far-back',
      profile: PROFILE,
      releaseHeldActivation,
      rootPostId: 'post-0'
    });
    expect(statusHandle.appendTrace).toHaveBeenCalledWith({
      kind: 'note',
      text: '↧ _my context reaches back to September 21, 2026 at 12:00:00 PM UTC; the earliest post waiting is older_'
    });
  });

  it('should trace nothing about a drain whose post the window reached (§5.2)', async () => {
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await turnRunner.run({
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      drainedFromPostId: 'post-0',
      profile: PROFILE,
      releaseHeldActivation,
      rootPostId: 'post-0'
    });
    expect(statusHandle.appendTrace).not.toHaveBeenCalled();
  });

  it('should return killed immediately while a completion is still in flight', async () => {
    complete.mockImplementationOnce(() => new Promise(() => undefined));
    const running = run();
    await new Promise((resolve) => setImmediate(resolve));
    turnControlRegistry.abortChannel('channel-1', 'killed', 'casey');
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
    expect(statusHandle.close).toHaveBeenCalledWith('semantic_error', undefined);
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

  it('should close as a delivery failure rather than completed when the final output cannot be posted', async () => {
    complete.mockResolvedValueOnce(Result.ok(text('lost reply')));
    transportSend.mockResolvedValueOnce(Result.err({ kind: 'api', message: 'mattermost is down' }));
    const outcome = await run();
    expect(outcome.status).toBe('delivery_failure');
    expect(conversationsService.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'lost reply' }),
      expect.anything()
    );
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
    expect(await run()).toStrictEqual({
      contextAssembledAt: new Date(0),
      status: 'completed',
      turnId: 'turn-1',
      windowPostIds: new Set(['post-0'])
    });
  });

  it('should log, not throw, when disposing the browsing session fails', async () => {
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    webService.endTurn.mockRejectedValueOnce(new Error('the browser is wedged'));
    expect(await run()).toStrictEqual({
      contextAssembledAt: new Date(0),
      status: 'completed',
      turnId: 'turn-1',
      windowPostIds: new Set(['post-0'])
    });
    expect(loggingService.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'failed to dispose the browsing session' })
    );
  });

  it('should end a turn the provider refused for length as context exhausted, naming the cause (§7.1)', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    complete.mockResolvedValueOnce(
      Result.err({ kind: 'context-overflow', status: 400 } satisfies InferenceFailure.ContextOverflow)
    );
    const outcome = await run();
    expect(outcome.status).toBe('context_exhausted');
    expect(sends.at(-1)?.text).toContain('ran out of room in my context part-way through this turn');
  });

  it('should report the unit it was working blocked, to its creator, after its own notice (§3.15)', async () => {
    tasksService.prepareExhaustionReport.mockResolvedValue({
      addressee: 'sam',
      prepared: { to: 'blocked', unitId: 'unit-1' },
      text: '@sam — unit `unit-1` is blocked: context exhausted'
    });
    complete.mockResolvedValueOnce(Result.err({ kind: 'context-overflow' } satisfies InferenceFailure.ContextOverflow));
    await run();
    expect(sends.map((send) => send.text)).toStrictEqual([
      expect.stringContaining('My starting context does not fit'),
      '@sam — unit `unit-1` is blocked: context exhausted'
    ]);
    expect(tasksService.commitTransition).toHaveBeenCalledExactlyOnceWith(
      { to: 'blocked', unitId: 'unit-1' },
      'post-2'
    );
  });

  it('should call a starting context the provider refused a configuration problem (§7.1)', async () => {
    complete.mockResolvedValueOnce(Result.err({ kind: 'context-overflow' } satisfies InferenceFailure.ContextOverflow));
    const outcome = await run();
    expect(outcome.status).toBe('context_exhausted');
    expect(sends.at(-1)?.text).toContain('My starting context does not fit');
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

  it('should close as provider_rejected and say so, rather than blaming reachability', async () => {
    complete.mockResolvedValueOnce(
      Result.err({ kind: 'provider', message: 'deepseek responded with status 400: invalid schema', status: 400 })
    );
    const outcome = await run();
    expect(outcome.status).toBe('provider_rejected');
    expect(sends.at(-1)?.text).toContain('rejected');
  });

  it('should end the turn as a delivery failure when an approval prompt cannot be posted', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    toolExecutor.execute.mockResolvedValue({
      detail: 'the approval prompt could not be posted',
      kind: 'terminal',
      status: 'delivery_failure'
    } satisfies ToolAttempt);
    const outcome = await run();
    expect(outcome.status).toBe('delivery_failure');
    expect(sends.at(-1)?.text).toContain('chat server refused');
  });

  describe('a post a tool returned (§3.15)', () => {
    const post = (onPublished: (postId: string) => Promise<void>): ToolAttempt => ({
      kind: 'continue',
      output: 'unit abcd1234 assigned to @owen',
      post: { onPublished, text: '@owen — work unit `abcd1234`' }
    });

    it('should publish it under the agent, record it with the turn, then tell the tool the post id', async () => {
      const onPublished = vi.fn<(postId: string) => Promise<void>>().mockImplementation(() => {
        expect(conversationsService.record).toHaveBeenCalledWith(
          expect.objectContaining({ authorKind: 'agent', message: '@owen — work unit `abcd1234`' }),
          { kind: 'notice', turnId: 'turn-1' }
        );
        return Promise.resolve();
      });
      multiMentionPolicy.addresseesOf.mockReturnValue(['owen']);
      complete.mockResolvedValueOnce(Result.ok(toolUse(['tasks__assign'])));
      toolExecutor.execute.mockResolvedValueOnce(post(onPublished));
      complete.mockResolvedValueOnce(Result.ok(text('handed over')));
      await run();
      expect(onPublished).toHaveBeenCalledExactlyOnceWith('post-1');
      expect(sends.map((send) => send.text)).toStrictEqual(['@owen — work unit `abcd1234`', 'handed over']);
    });

    it('should let a tool post mention its addressee alone (§4.5)', async () => {
      multiMentionPolicy.stripAgentMentionsExcept.mockImplementation((text: string, addressee: string | undefined) => {
        return text.replaceAll(/@(\w+)/gu, (mention, name: string) => (name === addressee ? mention : name));
      });
      complete.mockResolvedValueOnce(Result.ok(toolUse(['tasks__assign'])));
      toolExecutor.execute.mockResolvedValueOnce({
        kind: 'continue',
        output: 'assigned',
        post: { addressee: 'owen', onPublished: () => Promise.resolve(), text: '@owen take this from @tess' }
      });
      complete.mockResolvedValueOnce(Result.ok(text('done')));
      await run();
      expect(sends[0]?.text).toBe('@owen take this from tess');
      expect(multiMentionPolicy.stripAgentMentionsExcept).toHaveBeenCalledWith('@owen take this from @tess', 'owen');
    });

    it('should refuse a post addressing a second peer as the call’s result, writing nothing', async () => {
      const onPublished = vi.fn<(postId: string) => Promise<void>>();
      multiMentionPolicy.refusesSecondAddressee.mockReturnValueOnce(true);
      complete.mockResolvedValueOnce(Result.ok(toolUse(['tasks__assign'])));
      toolExecutor.execute.mockResolvedValueOnce(post(onPublished));
      complete.mockResolvedValueOnce(Result.ok(text('done')));
      await run();
      expect(onPublished).not.toHaveBeenCalled();
      expect(sends.map((send) => send.text)).toStrictEqual(['done']);
      expect(complete.mock.calls[1]![0].messages.at(-1)).toMatchObject({
        content: expect.stringContaining('post refused: this turn has already addressed'),
        role: 'tool'
      });
    });

    it('should hold the colleague it addressed until the turn ends, then release the earliest post once (§5.2)', async () => {
      multiMentionPolicy.addresseesOf.mockReturnValue(['owen']);
      complete.mockResolvedValueOnce(Result.ok(toolUse(['tasks__assign'])));
      toolExecutor.execute.mockResolvedValueOnce(post(() => Promise.resolve()));
      complete.mockImplementationOnce(() => {
        expect(releaseHeldActivation).not.toHaveBeenCalled();
        return Promise.resolve(Result.ok(text('@owen one more thing')));
      });
      await run();
      expect(releaseHeldActivation).toHaveBeenCalledExactlyOnceWith({ addresseeUsername: 'owen', postId: 'post-1' });
    });

    it('should release the colleague when the turn parks on a person, and not again when it ends (§5.2)', async () => {
      multiMentionPolicy.addresseesOf.mockReturnValueOnce(['owen']);
      complete.mockResolvedValueOnce(Result.ok(toolUse(['tasks__assign'])));
      toolExecutor.execute.mockResolvedValueOnce(post(() => Promise.resolve()));
      complete.mockResolvedValueOnce(Result.ok(toolUse(['workspace__write'])));
      toolExecutor.execute.mockImplementationOnce(async ({ appendEvent }) => {
        expect(releaseHeldActivation).not.toHaveBeenCalled();
        await appendEvent({
          approvalId: 'approval-1',
          kind: 'approval_requested',
          payloadText: 'x',
          toolName: 'write'
        });
        expect(releaseHeldActivation).toHaveBeenCalledExactlyOnceWith({ addresseeUsername: 'owen', postId: 'post-1' });
        return { kind: 'continue', output: 'written' };
      });
      complete.mockResolvedValueOnce(Result.ok(text('done')));
      await run();
      expect(releaseHeldActivation).toHaveBeenCalledOnce();
    });

    it('should end the turn as a delivery failure when the post cannot be sent, writing nothing', async () => {
      const onPublished = vi.fn<(postId: string) => Promise<void>>();
      transportSend.mockResolvedValueOnce(Result.err({ message: 'refused' }));
      complete.mockResolvedValueOnce(Result.ok(toolUse(['tasks__assign'])));
      toolExecutor.execute.mockResolvedValueOnce(post(onPublished));
      const outcome = await run();
      expect(outcome.status).toBe('delivery_failure');
      expect(onPublished).not.toHaveBeenCalled();
    });
  });

  it('should write a returned disclosure into the turn events, not the status post (§3.6)', async () => {
    complete.mockResolvedValueOnce(Result.ok(toolUse(['memory__write'])));
    complete.mockResolvedValueOnce(Result.ok(text('saved')));
    toolExecutor.execute.mockResolvedValueOnce({
      disclosure: {
        body: 'casey prefers pnpm',
        description: 'tooling preference',
        reference: 'memory-1',
        revisionOf: 'memory-0',
        supersededDescriptions: ['an ancient note']
      },
      kind: 'continue',
      output: 'ok'
    });
    await run();
    expect(turnsService.appendEvent).toHaveBeenCalledWith(
      'turn-1',
      expect.objectContaining({ kind: 'record_written', reference: 'memory-1', revisionOf: 'memory-0' })
    );
    expect(statusHandle.appendTrace).not.toHaveBeenCalledWith(expect.stringContaining('tooling preference'));
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
      turnControlRegistry.abortChannel('channel-1', 'stopped', 'casey');
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
    turnControlRegistry.abortChannel('channel-1', 'killed', 'casey');
    expect((await running).status).toBe('killed');
    expect(statusHandle.close).toHaveBeenCalledWith('killed', 'casey');
  });

  it('should end the turn as a delivery failure when the extension prompt cannot be delivered', async () => {
    approvalsService.request.mockResolvedValueOnce(
      Result.err({ kind: 'prompt-undeliverable', message: 'mattermost is down' })
    );
    complete.mockResolvedValueOnce(Result.ok(toolUse(Array.from({ length: 11 }, () => 'lookup_fixture'))));
    const outcome = await run();
    expect(outcome.status).toBe('delivery_failure');
    expect(sends.map((send) => send.text)).toStrictEqual([
      '⚠️ **Error**: The chat server refused a post I had to make'
    ]);
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
      turnControlRegistry.abortChannel('channel-1', 'stopped', 'casey');
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
    complete.mockResolvedValueOnce(
      Result.err({ kind: 'transport', reason: 'unknown' } satisfies InferenceFailure.Transport)
    );
    transportSend.mockResolvedValueOnce(Result.err({ kind: 'api', message: 'mattermost is down' }));
    const outcome = await run();
    expect(outcome.status).toBe('provider_outage');
    expect(conversationsService.record).not.toHaveBeenCalled();
  });

  it('should log and carry on when a posted notice cannot be recorded', async () => {
    complete.mockResolvedValueOnce(
      Result.err({ kind: 'transport', reason: 'unknown' } satisfies InferenceFailure.Transport)
    );
    conversationsService.record.mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    const outcome = await run();
    expect(outcome.status).toBe('provider_outage');
    expect(statusHandle.close).toHaveBeenCalledWith('provider_outage', undefined);
  });

  it('should accumulate reported usage, tokens and cost alike, across every completion in the turn', async () => {
    complete.mockResolvedValueOnce(
      Result.ok(
        toolUse(['lookup_fixture'], '', {
          cachedPromptTokens: undefined,
          completionTokens: 2,
          costUsd: 0.25,
          promptTokens: 3,
          reasoningTokens: 1
        })
      )
    );
    complete.mockResolvedValueOnce(
      Result.ok(
        text('done', {
          cachedPromptTokens: undefined,
          completionTokens: 5,
          costUsd: 0.5,
          promptTokens: 7,
          reasoningTokens: undefined
        })
      )
    );
    await run();
    expect(turnsService.close).toHaveBeenCalledWith(
      'turn-1',
      'completed',
      expect.objectContaining({
        usage: {
          cachedPromptTokens: undefined,
          completionTokens: 7,
          costUsd: 0.75,
          promptTokens: 10,
          reasoningTokens: 1
        }
      })
    );
  });

  it('should feed output cut at the length limit back as a rejection and post the shorter retry (§7.1)', async () => {
    complete.mockResolvedValueOnce(Result.ok({ content: 'a very long', kind: 'truncated', usage: undefined }));
    complete.mockResolvedValueOnce(Result.ok(text('short')));
    const outcome = await run();
    expect(outcome.status).toBe('completed');
    expect(sends.map((send) => send.text)).toStrictEqual(['short']);
    const retryRequest = complete.mock.calls[1]![0];
    expect(retryRequest.messages.slice(-2)).toStrictEqual([
      { content: 'a very long', role: 'assistant' },
      { content: expect.stringContaining('cut off at the output limit'), role: 'user' }
    ]);
    expect(turnsService.close).toHaveBeenCalledWith('turn-1', 'completed', expect.objectContaining({ actionCount: 1 }));
  });

  it('should end the turn after two consecutive rejected posts, saying so under its own name (§4.5)', async () => {
    multiMentionPolicy.refuses.mockReturnValue(true);
    complete.mockResolvedValue(Result.ok(text('@owen and @tess, split this')));
    const outcome = await run();
    expect(outcome.status).toBe('semantic_error');
    expect(complete).toHaveBeenCalledTimes(3);
    expect(sends.map((send) => send.text)).toStrictEqual([
      'I could not produce a reply the framework would accept and stopped. The reason is in the trace.'
    ]);
    expect(turnsService.close).toHaveBeenCalledWith(
      'turn-1',
      'semantic_error',
      expect.objectContaining({ actionCount: 2 })
    );
  });

  it('should reset the rejection count when a tool call runs between two rejections (§4.5)', async () => {
    multiMentionPolicy.refuses.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(true);
    complete.mockResolvedValueOnce(Result.ok(text('@owen and @tess, split this')));
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    complete.mockResolvedValueOnce(Result.ok(text('@owen and @tess, split this')));
    complete.mockResolvedValueOnce(Result.ok(text('@owen and @tess, split this')));
    complete.mockResolvedValueOnce(Result.ok(text('@owen, please take this')));
    const outcome = await run();
    expect(outcome.status).toBe('completed');
    expect(sends.map((send) => send.text)).toStrictEqual(['@owen, please take this']);
  });

  it('should reject a reply longer than a post holds, stating both lengths, and never truncate it (§4.5)', async () => {
    maxPostSizeChars.mockResolvedValue(Result.ok(10));
    complete.mockResolvedValueOnce(Result.ok(text('ééééééééééé')));
    complete.mockResolvedValueOnce(Result.ok(text('short')));
    const outcome = await run();
    expect(outcome.status).toBe('completed');
    expect(sends.map((send) => send.text)).toStrictEqual(['short']);
    expect(complete.mock.calls[1]![0].messages.at(-1)).toStrictEqual({
      content: expect.stringContaining('the reply is 11 characters and a post holds at most 10'),
      role: 'user'
    });
  });

  it('should refuse a tool post longer than a post holds as the call’s result, writing nothing (§4.5)', async () => {
    maxPostSizeChars.mockResolvedValue(Result.ok(10));
    const onPublished = vi.fn(() => Promise.resolve());
    toolExecutor.execute.mockResolvedValueOnce({
      kind: 'continue',
      output: 'unit assigned',
      post: { onPublished, text: '@owen take this long unit' }
    });
    complete.mockResolvedValueOnce(Result.ok(toolUse(['tasks__assign'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await run();
    expect(onPublished).not.toHaveBeenCalled();
    expect(complete.mock.calls[1]![0].messages.at(-1)).toMatchObject({
      content: expect.stringContaining('post refused: it is 25 characters'),
      role: 'tool'
    });
  });

  it('should count a truncated completion and a tool call written as text against the same limit (§4.5)', async () => {
    complete.mockResolvedValueOnce(Result.ok({ content: 'a very long', kind: 'truncated', usage: undefined }));
    complete.mockResolvedValueOnce(Result.ok(text('[called triggers__resolve({"id":"s8a15c97"})]')));
    complete.mockResolvedValueOnce(Result.ok(text('[called triggers__resolve({"id":"s8a15c97"})]')));
    const outcome = await run();
    expect(outcome.status).toBe('semantic_error');
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it('should still ask for an extension when rejections exhaust a one-attempt budget (§5.3)', async () => {
    multiMentionPolicy.refuses.mockReturnValue(true);
    complete.mockResolvedValue(Result.ok(text('@owen and @tess, split this')));
    const outcome = (
      await turnRunner.run({
        chainLength: 1,
        channelId: 'channel-1',
        depth: 0,
        profile: { ...PROFILE, actionBudget: 1 },
        releaseHeldActivation,
        rootPostId: 'post-0'
      })
    ).unwrap();
    expect(approvalsService.request).toHaveBeenCalledOnce();
    expect(outcome.status).toBe('budget_exhausted');
  });

  it('should run a completion’s concurrent calls together and record their results in call order', async () => {
    toolRegistry.isConcurrent.mockImplementation((_profile, name: string) => name === 'web__fetch');
    let releaseFirst: (attempt: ToolAttempt) => void = () => undefined;
    toolExecutor.execute.mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)));
    toolExecutor.execute.mockImplementationOnce(() => {
      expect(toolExecutor.execute).toHaveBeenCalledTimes(2);
      releaseFirst({ kind: 'continue', output: 'first page' });
      return Promise.resolve({ kind: 'continue', output: 'second page' } satisfies ToolAttempt);
    });
    complete.mockResolvedValueOnce(Result.ok(toolUse(['web__fetch', 'web__fetch'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await run();
    const followUp = complete.mock.calls[1]![0].messages;
    expect(followUp.slice(-2)).toStrictEqual([
      { content: 'first page', role: 'tool', toolCallId: 'call-0' },
      { content: 'second page', role: 'tool', toolCallId: 'call-1' }
    ]);
  });

  it('should run a call that is not concurrent only after the batch before it has finished', async () => {
    toolRegistry.isConcurrent.mockImplementation((_profile, name: string) => name === 'web__fetch');
    const order: string[] = [];
    toolExecutor.execute.mockImplementation(async ({ call }) => {
      order.push(`start ${call.id}`);
      await new Promise((resolve) => setImmediate(resolve));
      order.push(`end ${call.id}`);
      return { kind: 'continue', output: 'ok' };
    });
    complete.mockResolvedValueOnce(Result.ok(toolUse(['web__fetch', 'web__fetch', 'memory__write'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await run();
    expect(order).toStrictEqual([
      'start call-0',
      'start call-1',
      'end call-0',
      'end call-1',
      'start call-2',
      'end call-2'
    ]);
  });

  it('should answer every call that did not run with the reason once an extension is denied with one', async () => {
    approvalsService.request.mockResolvedValueOnce(
      Result.ok({ byUsername: 'casey', kind: 'denied-with-reason', reason: 'stop and summarise' })
    );
    complete.mockResolvedValueOnce(Result.ok(toolUse(Array.from({ length: 12 }, () => 'lookup_fixture'))));
    complete.mockResolvedValueOnce(Result.ok(text('here is what I have')));
    await run();
    expect(toolExecutor.execute).toHaveBeenCalledTimes(10);
    const finalRequest = complete.mock.calls[1]![0];
    const answers = finalRequest.messages.filter((message) => message.role === 'tool');
    expect(answers).toHaveLength(12);
    expect(answers.slice(-2).map((message) => message.content)).toStrictEqual([
      expect.stringContaining('stop and summarise'),
      expect.stringContaining('stop and summarise')
    ]);
  });

  const assembledWith = (content: string) => ({
    assembledAt: new Date(0),
    reachesBackTo: undefined,
    request: {
      cacheKey: 'mira:channel-1',
      messages: [{ content, role: 'user' as const }],
      model: { name: 'deepseek-v4-flash' as const, provider: 'deepseek' as const },
      systemPrompt: 'sys',
      tools: []
    },
    windowPostIds: new Set(['post-0'])
  });

  it('should retire the oldest page early under context pressure, never the one just recorded (§3.8)', async () => {
    toolRegistry.isSupersedable.mockImplementation((_profile, name: string) => name === 'web__fetch');
    for (const page of ['one', 'two']) {
      toolExecutor.execute.mockResolvedValueOnce({
        kind: 'continue',
        output: `page ${page} ${'x'.repeat(8_000)}`,
        replaySubject: `page ${page}`
      });
    }
    complete.mockResolvedValueOnce(Result.ok(toolUse(['web__fetch'])));
    complete.mockResolvedValueOnce(Result.ok(toolUse(['web__fetch'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await run();
    const results = complete.mock.calls[2]![0].messages.filter((message) => message.role === 'tool');
    expect(results[0]?.content).toBe(renderSupersededLine('page one'));
    expect(results[1]?.content.startsWith('page two x')).toBe(true);
    expect(results[1]?.content).not.toContain('truncated');
  });

  it('should cut a result that alone would not fit, marking the cut, and keep the trace whole (§3.8)', async () => {
    const output = 'y'.repeat(20_000);
    toolExecutor.execute.mockResolvedValueOnce({ kind: 'continue', output });
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    const outcome = await run();
    expect(outcome.status).toBe('completed');
    const result = complete.mock.calls[1]![0].messages.at(-1);
    expect(result?.content).toMatch(/y\n…result truncated to fit this turn's context; the full text is in the trace$/u);
    expect(result?.content.length).toBeLessThan(output.length);
    expect(turnsService.appendEvent).toHaveBeenCalledWith(
      'turn-1',
      expect.objectContaining({ kind: 'tool_result', output })
    );
  });

  it('should end the turn as context exhausted when nothing can be retired and a cut would keep too little (§3.8)', async () => {
    contextAssembler.assemble.mockResolvedValue(assembledWith('z'.repeat(12_000)));
    toolExecutor.execute.mockResolvedValueOnce({ kind: 'continue', output: 'w'.repeat(4_000) });
    complete.mockResolvedValueOnce(Result.ok(toolUse(['lookup_fixture'])));
    const outcome = await run();
    expect(outcome.status).toBe('context_exhausted');
    expect(sends.at(-1)?.text).toContain('ran out of room in my context part-way through this turn');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('should call a starting context over the ceiling a configuration problem, calling no provider (§3.8)', async () => {
    contextAssembler.assemble.mockResolvedValue(assembledWith('z'.repeat(16_000)));
    const outcome = await run();
    expect(outcome.status).toBe('context_exhausted');
    expect(sends.at(-1)?.text).toContain('My starting context does not fit');
    expect(complete).not.toHaveBeenCalled();
  });

  // the profile's 3,400-token ceiling retains 1,020 tokens of pages (§3.8); a page this size is about 700
  const pageText = (name: string) => `page ${name} ${'x'.repeat(2_800)}`;

  const toolMessagesOf = (request: CompletionRequest) => {
    return request.messages.filter((message) => message.role === 'tool').map((message) => message.content);
  };

  it('should keep every result of one completion verbatim until the model has read it (§3.8)', async () => {
    toolRegistry.isSupersedable.mockReturnValue(true);
    toolRegistry.isConcurrent.mockReturnValue(true);
    let read = 0;
    toolExecutor.execute.mockImplementation(() => Promise.resolve({ kind: 'continue', output: pageText(`${read++}`) }));
    const seen: string[][] = [];
    complete.mockImplementationOnce((request) => {
      seen.push(toolMessagesOf(request));
      return Promise.resolve(Result.ok(toolUse(['workspace__read', 'workspace__read', 'workspace__read'])));
    });
    complete.mockImplementationOnce((request) => {
      seen.push(toolMessagesOf(request));
      return Promise.resolve(Result.ok(toolUse(['workspace__read'])));
    });
    complete.mockImplementationOnce((request) => {
      seen.push(toolMessagesOf(request));
      return Promise.resolve(Result.ok(text('done')));
    });
    await run();
    expect(seen[1]).toStrictEqual([pageText('0'), pageText('1'), pageText('2')]);
    expect(seen[2]).toStrictEqual([
      renderSupersededLine(describeReplaySubject('workspace__read result', pageText('0'))),
      renderSupersededLine(describeReplaySubject('workspace__read result', pageText('1'))),
      pageText('2'),
      pageText('3')
    ]);
  });

  const readPages = (names: string[]) => {
    toolRegistry.isSupersedable.mockImplementation((_profile, name: string) => name === 'web__fetch');
    for (const name of names) {
      toolExecutor.execute.mockResolvedValueOnce({
        kind: 'continue',
        output: pageText(name),
        replaySubject: `page ${name}`
      });
      complete.mockResolvedValueOnce(Result.ok(toolUse(['web__fetch'])));
    }
    complete.mockResolvedValueOnce(Result.ok(text('done')));
  };

  it('should keep every page verbatim while they fit the retention share (§3.8)', async () => {
    toolRegistry.isSupersedable.mockImplementation((_profile, name: string) => name === 'web__fetch');
    for (const name of ['one', 'two', 'three', 'four', 'five']) {
      toolExecutor.execute.mockResolvedValueOnce({
        kind: 'continue',
        output: `page ${name}`,
        replaySubject: `page ${name}`
      });
      complete.mockResolvedValueOnce(Result.ok(toolUse(['web__fetch'])));
    }
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await run();
    expect(toolMessagesOf(complete.mock.calls[5]![0])).toStrictEqual([
      'page one',
      'page two',
      'page three',
      'page four',
      'page five'
    ]);
  });

  it('should collapse the oldest read page to its in-turn line past the share, never below two (§3.8)', async () => {
    readPages(['one', 'two', 'three']);
    await run();
    expect(toolMessagesOf(complete.mock.calls[3]![0])).toStrictEqual([
      renderSupersededLine('page one'),
      pageText('two'),
      pageText('three')
    ]);
    expect(turnsService.appendEvent).toHaveBeenCalledWith(
      'turn-1',
      expect.objectContaining({ kind: 'tool_result', output: pageText('one'), replaySubject: 'page one' })
    );
  });

  it('should answer a byte-identical repeat without evicting a sibling (§3.8)', async () => {
    readPages(['one', 'two', 'three', 'two', 'one']);
    await run();
    expect(toolMessagesOf(complete.mock.calls[5]![0])).toStrictEqual([
      renderSupersededLine('page one'),
      pageText('two'),
      pageText('three'),
      renderDuplicateLine('page two'),
      `[identical to a result you read earlier this turn; nothing changed]\n\n${pageText('one')}`
    ]);
  });

  it('should hand the completion a signal that aborts on /kill', async () => {
    let signal: AbortSignal | undefined;
    complete.mockImplementationOnce((_request, options) => {
      signal = options?.signal;
      return new Promise(() => undefined);
    });
    const running = run();
    await new Promise((resolve) => setImmediate(resolve));
    expect(signal?.aborted).toBe(false);
    turnControlRegistry.abortChannel('channel-1', 'killed', 'casey');
    await running;
    expect(signal?.aborted).toBe(true);
  });

  it('should keep structured reasoning on the event and the replayed message, never in a post (§3.12)', async () => {
    const reasoningDetails = [{ index: 0, signature: 'sig', text: 'private', type: 'reasoning.text' }];
    complete.mockResolvedValueOnce(
      Result.ok({ ...toolUse(['write_file']), reasoningDetails } satisfies CompletionResult)
    );
    complete.mockResolvedValueOnce(Result.ok(text('done')));
    await run();
    expect(complete.mock.calls[1]![0].messages.at(-2)).toMatchObject({ reasoningDetails, role: 'assistant' });
    expect(turnsService.appendEvent.mock.calls[0]![1]).toMatchObject({ kind: 'assistant_message', reasoningDetails });
    expect(JSON.stringify(sends)).not.toContain('private');
  });

  it('should post no delegation-limit notice at depth ten when the output names no agent', async () => {
    complete.mockResolvedValueOnce(Result.ok(text('nothing to delegate')));
    const outcome = (
      await turnRunner.run({
        chainLength: 1,
        channelId: 'channel-1',
        depth: 10,
        profile: PROFILE,
        releaseHeldActivation,
        rootPostId: 'post-0'
      })
    ).unwrap();
    expect(outcome.status).toBe('completed');
    expect(sends.map((send) => send.text)).toStrictEqual(['nothing to delegate']);
  });
});
