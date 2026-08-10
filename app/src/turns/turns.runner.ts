import type { Tool } from '@collegium/core/tools';
import type { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { match } from 'ts-pattern';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { ApprovalsService } from '@/approvals/approvals.service.ts';
import type { ApprovalDecision } from '@/approvals/approvals.types.ts';
import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import type { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import type { InferenceClient } from '@/inference/inference.client.ts';
import { InferenceRegistry } from '@/inference/inference.registry.ts';
import type {
  CompletionMessage,
  CompletionRequest,
  CompletionResult,
  InferenceFailure,
  ToolCall
} from '@/inference/inference.types.ts';
import { describeInferenceFailure } from '@/inference/inference.utils.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import type { TurnStatus } from '@/prisma/prisma.types.ts';
import { ToolExecutor } from '@/tools/tools.executor.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';
import type { ToolAttempt } from '@/tools/tools.types.ts';
import { extractMentionedUsernames } from '@/utils/mention.utils.ts';
import { WebService } from '@/web/web.service.ts';

import { ActionBudget } from './budget/action.budget.ts';
import { renderExtensionDenialResult } from './budget/budget.renderer.ts';
import { ContextAssembler } from './context/context.assembler.ts';
import { TurnControlRegistry } from './control/turn-control.registry.ts';
import { TurnFoldRegistry } from './folding/turn-fold.registry.ts';
import {
  renderBudgetExhaustedNotice,
  renderContextShortfallLine,
  renderDelegationLimitNotice,
  renderDenialNotice,
  renderExtensionPrompt,
  renderMemoryEvictionLine,
  renderMemoryWriteLine,
  renderProviderOutageNotice,
  renderProviderRejectionNotice,
  renderSemanticErrorNotice,
  renderSideEffectAmbiguityNotice,
  renderToolCallLine
} from './status/status-post.renderer.ts';
import { StatusPostService } from './status/status-post.service.ts';
import { TurnsService } from './turns.service.ts';
import { TypingIndicatorService } from './typing/typing-indicator.service.ts';

import type { TurnControlHandle } from './control/turn-control.registry.ts';
import type { TurnFoldHandle } from './folding/turn-fold.registry.ts';
import type { StatusPostHandle } from './status/status-post.service.ts';
import type { Turn, TurnOutcome } from './turns.types.ts';

/** §7.4 — ten agent-to-agent hops from the nearest human is where a delegation chain ends */
const DELEGATION_DEPTH_LIMIT = 10;

/**
 * §4.4 — how many times one turn will discard a completion to take a further fragment. The
 * pre-turn ceiling bounds the window before a turn exists; this bounds the folding after, so a
 * human typing steadily reaches an answer instead of paying for a completion per sentence.
 */
const FOLD_LIMIT = 3;

type RunInput = {
  channelId: string;
  depth: number;
  /** set on a draining turn: the earliest unprocessed post the 👀 promised to read (§5.2) */
  drainedFromPostId?: string;
  /** §4.4 — the human whose further fragments this turn absorbs; absent on every other turn */
  foldAuthorUsername?: string;
  profile: AgentProfile;
  triggeringPostId?: string;
};

/**
 * §5.3 — what an exhausted budget resolved to. `voice-only` is the reasoned denial: the turn keeps
 * running so the agent can answer, holding the human's reason, but every further action is refused.
 */
type Exhaustion = { kind: 'ended'; outcome: TurnOutcome } | { kind: 'extended' } | { kind: 'voice-only'; text: string };

type TurnState = {
  readonly budget: ActionBudget;
  readonly control: TurnControlHandle;
  readonly fold: TurnFoldHandle;
  readonly messages: CompletionMessage[];
  readonly status: StatusPostHandle;
  readonly transport: ChatTransport;
  readonly turn: Turn;
  usage: undefined | { completionTokens: number; promptTokens: number };
};

/**
 * The model loop of §3.3: assemble context once, then complete → dispatch until the model emits
 * text with no tool call, the action budget runs out, or a §7.1 exit fires. Everything §7.1 owes a
 * human lands here: the closing status, the status-post edit, and the notice under the agent's
 * name.
 *
 * This file is the one place difficulty is allowed: the model loop, the action budget, the failure
 * taxonomy, and denial semantics concentrate here so everything else reads as boring plumbing. If
 * code outside `turns/` starts to feel clever, it is in the wrong module.
 */
@Injectable()
export class TurnRunner {
  constructor(
    private readonly approvalsService: ApprovalsService,
    private readonly contextAssembler: ContextAssembler,
    private readonly conversationsService: ConversationsService,
    private readonly inferenceRegistry: InferenceRegistry,
    private readonly loggingService: LoggingService,
    private readonly multiMentionPolicy: MultiMentionPolicy,
    private readonly statusPostService: StatusPostService,
    private readonly toolExecutor: ToolExecutor,
    private readonly toolRegistry: ToolRegistry,
    private readonly transportRegistry: TransportRegistry,
    private readonly turnControlRegistry: TurnControlRegistry,
    private readonly turnFoldRegistry: TurnFoldRegistry,
    private readonly turnsService: TurnsService,
    private readonly typingIndicatorService: TypingIndicatorService,
    private readonly webService: WebService
  ) {}

  async run(input: RunInput): Promise<TurnOutcome> {
    const { channelId, profile } = input;
    const turn = await this.turnsService.open({
      agentUsername: profile.username,
      channelId,
      depth: input.depth,
      modelName: profile.model.name,
      triggeringPostId: input.triggeringPostId
    });
    const state: TurnState = {
      budget: new ActionBudget(),
      control: this.turnControlRegistry.register(turn.id, channelId),
      fold: this.turnFoldRegistry.register({
        agentUsername: profile.username,
        authorUsername: input.foldAuthorUsername,
        channelId
      }),
      messages: [],
      status: this.statusPostService.open({ agentUsername: profile.username, channelId, turnId: turn.id }),
      transport: this.transportRegistry.get(profile.username),
      turn,
      usage: undefined
    };
    try {
      return await this.runLoop(input, state);
    } catch (error) {
      this.loggingService.error(
        new Error(`the turn for "${profile.username}" hit a framework error`, { cause: error })
      );
      await this.postNotice(input, state, renderSemanticErrorNotice('something went wrong inside the framework'));
      return this.close(state, 'semantic_error');
    } finally {
      try {
        await this.webService.endTurn(turn.id);
      } catch (error) {
        this.loggingService.error(new Error('failed to dispose the browsing session', { cause: error }));
      }
      state.control.release();
      state.fold.release();
    }
  }

  /** best-effort on both writes: a close that itself fails must never leave the turn 'running' silently */
  private async close(state: TurnState, status: Exclude<TurnStatus, 'running'>): Promise<TurnOutcome> {
    try {
      await state.status.close(status);
    } catch (error) {
      this.loggingService.error(new Error('failed to close the status post', { cause: error }));
    }
    try {
      await this.turnsService.close(state.turn.id, status, {
        actionCount: state.budget.spentCount,
        usage: state.usage
      });
    } catch (error) {
      this.loggingService.error(new Error(`failed to close turn ${state.turn.id} as ${status}`, { cause: error }));
    }
    return { status, turnId: state.turn.id };
  }

  private async closeOnInferenceFailure(
    input: RunInput,
    state: TurnState,
    failure: InferenceFailure
  ): Promise<TurnOutcome> {
    // every branch logs: an inference failure the operator cannot see is one nobody can diagnose
    this.loggingService.error(
      new Error(`inference failed for "${input.profile.username}": ${describeInferenceFailure(failure)}`)
    );
    if (failure.kind === 'malformed') {
      await this.postNotice(input, state, renderSemanticErrorNotice('my reply could not be understood'));
      return this.close(state, 'semantic_error');
    }
    const notice =
      failure.kind === 'provider' ? renderProviderRejectionNotice(failure.status) : renderProviderOutageNotice();
    await this.postNotice(input, state, notice);
    return this.close(state, 'provider_outage');
  }

  private async closeOnToolFailure(
    input: RunInput,
    state: TurnState,
    call: ToolCall,
    attempt: ToolAttempt.Terminal
  ): Promise<TurnOutcome> {
    if (attempt.status === 'semantic_error' || attempt.status === 'side_effect_ambiguous') {
      await this.turnsService.appendEvent(state.turn.id, {
        callId: call.id,
        kind: 'tool_result',
        output: attempt.detail,
        toolName: call.name
      });
    }
    const notice = match(attempt.status)
      .with('denied', () => renderDenialNotice())
      .with('provider_outage', () => renderProviderOutageNotice())
      .with('semantic_error', () => renderSemanticErrorNotice(attempt.detail))
      .with('side_effect_ambiguous', () => renderSideEffectAmbiguityNotice(call.name))
      // §7.5 — a cancellation posts no follow-up; the command or halt already spoke
      .with('halted', 'killed', 'stopped', () => undefined)
      .exhaustive();
    if (notice !== undefined) {
      await this.postNotice(input, state, notice);
    }
    return this.close(state, attempt.status);
  }

  /**
   * A reply that could not be posted is not a completion: §7.1 defines normal completion as
   * visible as the final post. The turn closes as an outage — a non-progress exit, so the queue
   * is left standing rather than drained into the same dead substrate — and the undelivered text
   * is recorded in the trace so it exists somewhere.
   */
  private async closeWithFinalOutput(input: RunInput, state: TurnState, content: string): Promise<TurnOutcome> {
    const sent = await state.transport.send({ channelId: input.channelId, text: content });
    if (!sent.success) {
      this.loggingService.error(new Error(`failed to post final output: ${sent.error.message}`));
      await this.turnsService.appendEvent(state.turn.id, { content, kind: 'assistant_message', toolCalls: [] });
      return this.close(state, 'provider_outage');
    }
    await this.conversationsService.record(
      {
        authorKind: 'agent',
        authorUsername: input.profile.username,
        channelId: input.channelId,
        createdAt: sent.value.createdAt,
        id: sent.value.postId,
        message: content
      },
      state.turn.id
    );
    return this.close(state, 'completed');
  }

  /**
   * §8.1 — the typing indicator is lit for exactly as long as the model is generating. Tool
   * execution and approval waits stay dark: the status post and the approval prompt speak there,
   * and an indicator held through a human's deliberation would be claiming work that is not
   * happening. The finally covers every exit, including the kill race and a thrown request.
   */
  private async complete(
    input: RunInput,
    state: TurnState,
    client: InferenceClient,
    request: CompletionRequest
  ): Promise<'killed' | Result<CompletionResult, InferenceFailure>> {
    const typing = this.typingIndicatorService.start({
      agentUsername: input.profile.username,
      channelId: input.channelId
    });
    try {
      return await Promise.race([client.complete({ ...request, messages: state.messages }), state.control.killed]);
    } finally {
      typing.stop();
    }
  }

  private createTurnScope(input: RunInput, state: TurnState): Tool.TurnScope {
    return {
      agentUsername: input.profile.username,
      channelId: input.channelId,
      discloseMemoryWrite: async (disclosure) => {
        await this.turnsService.appendEvent(state.turn.id, {
          body: disclosure.body,
          description: disclosure.description,
          kind: 'memory_written',
          memoryId: disclosure.memoryId
        });
        await state.status.appendTrace(renderMemoryWriteLine(disclosure));
        for (const evicted of disclosure.evictedDescriptions) {
          await state.status.appendTrace(renderMemoryEvictionLine(evicted));
        }
      },
      triggeringPostId: input.triggeringPostId ?? '',
      turnId: state.turn.id,
      workspaceDir: input.profile.workspaceDir
    };
  }

  private async dispatchToolCalls(
    input: RunInput,
    state: TurnState,
    completion: CompletionResult.ToolUse
  ): Promise<TurnOutcome | undefined> {
    await this.turnsService.appendEvent(state.turn.id, {
      content: completion.content,
      kind: 'assistant_message',
      toolCalls: completion.toolCalls.map((call) => ({ args: call.arguments, callId: call.id, toolName: call.name }))
    });
    state.messages.push({ content: completion.content, role: 'assistant', toolCalls: completion.toolCalls });
    if (completion.content !== '') {
      await state.status.setTransient(this.multiMentionPolicy.stripAgentMentions(completion.content));
    }
    for (const call of completion.toolCalls) {
      // §7.5 — /stop means no further tool calls, including the rest of this completion's batch
      const aborted = state.control.aborted();
      if (aborted) {
        return this.close(state, aborted);
      }
      if (state.budget.trySpend(call.name) === 'exhausted') {
        const exhaustion = await this.handleExhaustion(input, state);
        if (exhaustion.kind === 'ended') {
          return exhaustion.outcome;
        }
        if (exhaustion.kind === 'voice-only') {
          // §5.3 — the reason arrives as this call's result with zero attempts left, so the call
          // does not run and neither does anything after it in this completion's batch
          await this.turnsService.appendEvent(state.turn.id, {
            callId: call.id,
            kind: 'tool_result',
            output: exhaustion.text,
            toolName: call.name
          });
          state.messages.push({ content: exhaustion.text, role: 'tool', toolCallId: call.id });
          return undefined;
        }
        state.budget.trySpend(call.name);
      }
      const detail = this.toolRegistry.describeCall({
        args: call.arguments,
        name: call.name,
        profile: input.profile
      });
      await state.status.appendTrace(renderToolCallLine(call.name, detail));
      const attempt = await Promise.race([
        this.toolExecutor.execute({
          appendEvent: (event) => this.turnsService.appendEvent(state.turn.id, event),
          call,
          profile: input.profile,
          turn: this.createTurnScope(input, state)
        }),
        state.control.killed
      ]);
      if (attempt === 'killed') {
        return this.close(state, 'killed');
      }
      if (attempt.kind === 'terminal') {
        return this.closeOnToolFailure(input, state, call, attempt);
      }
      await this.turnsService.appendEvent(state.turn.id, {
        callId: call.id,
        kind: 'tool_result',
        output: attempt.output,
        toolName: call.name
      });
      state.messages.push({ content: attempt.output, role: 'tool', toolCallId: call.id });
    }
    return undefined;
  }

  /**
   * §7.4 — at the delegation limit the output still posts, but with its agent mentions stripped so
   * it cannot activate anyone, and the fixed notice tells the humans why the chain stopped here.
   */
  private async enforceDepthLimit(input: RunInput, state: TurnState, content: string): Promise<string> {
    if (input.depth < DELEGATION_DEPTH_LIMIT) {
      return content;
    }
    const stripped = this.multiMentionPolicy.stripAgentMentions(content);
    if (stripped !== content) {
      await this.postNotice(input, state, renderDelegationLimitNotice());
    }
    return stripped;
  }

  /**
   * §5.3 — on exhaustion the turn blocks on an approval to extend. Approving grants a further ten
   * attempts against the context accumulated so far; a bare denial ends the turn; a denial carrying
   * a reason ends the turn's actions but not its voice, so the reason comes back for the agent to
   * conclude in words. A turn whose extensions were already refused is never prompted twice.
   */
  private async handleExhaustion(input: RunInput, state: TurnState): Promise<Exhaustion> {
    // §7.5 — a stopped turn asks for nothing further, least of all an extension
    const aborted = state.control.aborted();
    if (aborted) {
      return { kind: 'ended', outcome: await this.close(state, aborted) };
    }
    if (!state.budget.acceptsExtension) {
      await this.postNotice(input, state, renderBudgetExhaustedNotice(state.budget.limitCount));
      return { kind: 'ended', outcome: await this.close(state, 'budget_exhausted') };
    }
    const extensionNumber = state.budget.extensionCount + 1;
    this.loggingService.log(
      `"${input.profile.username}" hit the action budget in ${input.channelId} (extension ${extensionNumber} requested)`
    );
    const decision = await this.approvalsService.request({
      agentUsername: input.profile.username,
      appendEvent: (event) => this.turnsService.appendEvent(state.turn.id, event),
      args: { attemptsSoFar: state.budget.spentCount, extensionNumber },
      channelId: input.channelId,
      payloadPresentation: 'collapse',
      payloadText: renderExtensionPrompt({ attemptsSoFar: state.budget.spentCount, extensionNumber }),
      toolName: 'extend_budget',
      turnId: state.turn.id
    });
    if (!decision.success) {
      return { kind: 'ended', outcome: await this.close(state, 'provider_outage') };
    }
    return (
      match<ApprovalDecision, Promise<Exhaustion>>(decision.value)
        .with({ kind: 'approved' }, () => {
          state.budget.extend();
          return Promise.resolve<Exhaustion>({ kind: 'extended' });
        })
        .with({ kind: 'cancelled' }, async ({ reason }) => ({
          kind: 'ended',
          outcome: await this.close(
            state,
            match(reason)
              .with('halt', () => 'halted' as const)
              .with('kill', () => 'killed' as const)
              // a live turn can only observe halt/kill/stop; restart cancellations exist for rows a dead process left
              .with('restart', () => 'halted' as const)
              .with('stop', () => 'stopped' as const)
              .exhaustive()
          )
        }))
        // §5.3 — bare denial is a full stop; the reasoned one leaves the turn a final word
        .with({ kind: 'denied' }, async () => {
          await this.postNotice(input, state, renderBudgetExhaustedNotice(state.budget.limitCount));
          return { kind: 'ended', outcome: await this.close(state, 'budget_exhausted') };
        })
        .with({ kind: 'denied-with-reason' }, ({ reason }) => {
          state.budget.refuseFurtherExtensions();
          return Promise.resolve<Exhaustion>({ kind: 'voice-only', text: renderExtensionDenialResult(reason) });
        })
        .exhaustive()
    );
  }

  /** §7.1's human-visible notices: deterministic strings posted under the agent's name (§3.2) */
  private async postNotice(input: RunInput, state: TurnState, text: string): Promise<void> {
    try {
      const sent = await state.transport.send({ channelId: input.channelId, text });
      if (!sent.success) {
        this.loggingService.error(new Error(`failed to post a turn notice: ${sent.error.message}`));
        return;
      }
      await this.conversationsService.record(
        {
          authorKind: 'agent',
          authorUsername: input.profile.username,
          channelId: input.channelId,
          createdAt: sent.value.createdAt,
          id: sent.value.postId,
          message: text
        },
        state.turn.id
      );
    } catch (error) {
      this.loggingService.error(new Error('failed to record a turn notice', { cause: error }));
    }
  }

  private refusesFinalOutput(input: RunInput, content: string): boolean {
    return this.multiMentionPolicy.refuses({
      authorUsername: input.profile.username,
      channelId: input.channelId,
      mentionedUsernames: extractMentionedUsernames(content)
    });
  }

  /** everything here may throw; run() owns the boundary so no exit can leave the turn 'running' */
  private async runLoop(input: RunInput, state: TurnState): Promise<TurnOutcome> {
    const { channelId, profile } = input;
    let assembled = await this.contextAssembler.assemble({ channelId, profile });
    state.messages.push(...assembled.request.messages);
    if (input.drainedFromPostId !== undefined && !assembled.windowPostIds.has(input.drainedFromPostId)) {
      await state.status.appendTrace(renderContextShortfallLine());
    }
    const client = this.inferenceRegistry.getClientForModel(profile.model);
    let folds = 0;
    for (;;) {
      const completion = await this.complete(input, state, client, assembled.request);
      if (completion === 'killed') {
        return this.close(state, 'killed');
      }
      // §7.5 — checked after every await, before any dispatch: the honest guarantee of /stop is
      // "no further tool calls and no further posts", not "nothing happened"
      const aborted = state.control.aborted();
      if (aborted) {
        return this.close(state, aborted);
      }
      if (!completion.success) {
        return this.closeOnInferenceFailure(input, state, completion.error);
      }
      if (completion.value.usage) {
        state.usage = {
          completionTokens: (state.usage?.completionTokens ?? 0) + completion.value.usage.completionTokens,
          promptTokens: (state.usage?.promptTokens ?? 0) + completion.value.usage.promptTokens
        };
      }
      if (this.takesFurtherFragments(state, folds)) {
        folds += 1;
        assembled = await this.contextAssembler.assemble({ channelId, profile });
        state.messages.splice(0, state.messages.length, ...assembled.request.messages);
        continue;
      }
      if (completion.value.kind === 'text') {
        const content = await this.enforceDepthLimit(input, state, completion.value.content);
        if (!this.refusesFinalOutput(input, content)) {
          return this.closeWithFinalOutput(input, state, content);
        }
        let rejection = 'post rejected: multiple agent mentions';
        if (state.budget.trySpendOnRejectedPost() === 'exhausted') {
          const exhaustion = await this.handleExhaustion(input, state);
          if (exhaustion.kind === 'ended') {
            return exhaustion.outcome;
          }
          if (exhaustion.kind === 'voice-only') {
            // no tool call to carry the reason here, so it joins the rejection in the same message
            rejection = `${rejection}\n\n${exhaustion.text}`;
          } else {
            state.budget.trySpendOnRejectedPost();
          }
        }
        // fed back as a user message — the final-output branch carries no tool call for a tool
        // result to reference (§4.5). Not a semantic failure: the model produced valid output
        // violating a framework rule it cannot see, and one retry is cheap.
        state.messages.push({ content, role: 'assistant' });
        state.messages.push({ content: rejection, role: 'user' });
        continue;
      }
      const outcome = await this.dispatchToolCalls(input, state, completion.value);
      if (outcome) {
        return outcome;
      }
    }
  }

  /**
   * §4.4 — consumes whatever activation handed this turn while the model was generating, and says
   * whether the completion just received is discarded for it. Sitting between the completion and
   * every branch that acts on one is what makes "folding only before the first action" structural:
   * past this point a tool has run or a post exists, and re-assembling would throw away work.
   *
   * Absorption closes the moment this turn declines to fold or reaches the last one it will take,
   * so a later fragment finds the §5.2 queue rather than a buffer nothing will read again.
   */
  private takesFurtherFragments(state: TurnState, folds: number): boolean {
    const takes = state.fold.takeOffered().length > 0 && folds < FOLD_LIMIT;
    if (!takes || folds + 1 >= FOLD_LIMIT) {
      state.fold.stopAbsorbing();
    }
    return takes;
  }
}
