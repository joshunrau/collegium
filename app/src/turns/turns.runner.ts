import { renderReplayLine } from '@collegium/core/tools';
import type { ToolPost, ToolTurnScope } from '@collegium/core/tools';
import { CHARS_PER_TOKEN, Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { match } from 'ts-pattern';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { ApprovalsService } from '@/approvals/approvals.service.ts';
import type { ApprovalDecision } from '@/approvals/approvals.types.ts';
import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import type { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConfigService } from '@/config/config.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import type { TurnRequest } from '@/conversations/conversations.types.ts';
import type { InferenceClient } from '@/inference/inference.client.ts';
import { InferenceRegistry } from '@/inference/inference.registry.ts';
import type {
  CompletionMessage,
  CompletionReasoning,
  CompletionRequest,
  CompletionResult,
  CompletionUsage,
  InferenceFailure,
  ToolCall,
  UnparsedToolCall
} from '@/inference/inference.types.ts';
import {
  addCompletionUsage,
  describeInferenceFailure,
  estimateMessageTokens,
  estimateRequestTokens,
  isUnparsedToolCall,
  reasoningOf,
  toReplayableToolCall
} from '@/inference/inference.utils.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import type { PostKind, TurnStatus } from '@/prisma/prisma.types.ts';
import { ToolExecutor } from '@/tools/tools.executor.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';
import type { ToolAttempt } from '@/tools/tools.types.ts';
import { extractMentionedUsernames } from '@/utils/mention.utils.ts';
import { WebService } from '@/web/web.service.ts';

import { renderApprovalContext } from './approval-context/approval-context.renderer.ts';
import { ActionBudget } from './budget/action.budget.ts';
import { renderExtensionDenialResult } from './budget/budget.renderer.ts';
import { ContextAssembler } from './context/context.assembler.ts';
import { containsToolCallTranscript } from './context/context.utils.ts';
import { TurnControlRegistry } from './control/turn-control.registry.ts';
import { TurnFoldRegistry } from './folding/turn-fold.registry.ts';
import {
  renderBudgetExhaustedNotice,
  renderChainLengthLimitNotice,
  renderContextExhaustedNotice,
  renderContextShortfallLine,
  renderDelegationLimitNotice,
  renderDeliveryFailureNotice,
  renderDenialNotice,
  renderExtensionPrompt,
  renderMayHaveTakenEffectLine,
  renderOutputRefusedNotice,
  renderProviderOutageNotice,
  renderProviderRejectionNotice,
  renderSemanticErrorNotice,
  renderSideEffectAmbiguityNotice,
  renderSteeringLine,
  renderToolCallLine
} from './status/status-post.renderer.ts';
import { StatusPostService } from './status/status-post.service.ts';
import { TurnsService } from './turns.service.ts';
import { TypingIndicatorService } from './typing/typing-indicator.service.ts';

import type { AssembledContext } from './context/context.assembler.ts';
import type { TurnControlHandle } from './control/turn-control.registry.ts';
import type { TurnFoldHandle } from './folding/turn-fold.registry.ts';
import type { StatusPostHandle } from './status/status-post.service.ts';
import type { Steering, Turn, TurnOpenFailure, TurnOutcome } from './turns.types.ts';

/** §3.8 — how many of a turn's supersedable results stay verbatim; the rest read as their replay line */
const RETAINED_SUPERSEDABLE_RESULTS = 2;

/** §7.1 — what a completion cut at the output limit hears; the loop it re-enters is the rejected post's (§4.5) */
const TRUNCATED_OUTPUT_REJECTION =
  'output rejected: it was cut off at the output limit before it finished — answer more briefly, or do the work in smaller steps';

/** §4.5 — rejections in a row a turn survives; the budget bounds the loop too, but with a number that says nothing about why */
const CONSECUTIVE_REJECTION_LIMIT = 2;

/**
 * §3.8 — the share of a model's window one turn's prompt may reach before its stale pages are
 * retired and, failing that, the turn ends. The remainder is the completion the model has yet to
 * write and the slack a character-ratio estimate owes a tokeniser it is not.
 */
const TURN_PROMPT_CEILING_SHARE = 0.85;

/** §3.8 — what a result cut to fit the window ends with; the trace holds the rest */
const RESULT_TRUNCATION_MARKER = '\n…result truncated to fit the context window; the full text is in the trace';

/** §3.8 — below this a cut result is not long but the turn has no room, and the honest outcome is exhaustion */
const RESULT_MIN_TOKENS = 500;

/** §7.2 — how many calls with unparseable arguments a turn survives; the second is a pattern, not a mistake */
const UNPARSED_CALL_LIMIT = 1;

/** §7.2 — how much of the provider's broken argument text the trace keeps; the model never sees any of it */
const RAW_ARGUMENTS_PREVIEW_CHARS = 200;

/** §7.2 — what the model reads instead of a diagnosis: no parameter, no type, no accepted set */
const UNPARSED_ARGUMENTS_RESULT = 'the arguments to this call were not valid JSON, so the call did not run';

/** the bounds config states for every turn: §7.4 depth and chain length, §4.4 folds; the §5.3 budget is the agent's own */
type TurnLimits = {
  readonly chainLengthLimit: number;
  readonly delegationDepthLimit: number;
  readonly foldLimit: number;
};

type RunInput = {
  chainLength: number;
  channelId: string;
  depth: number;
  /** set on a draining turn: the earliest unprocessed post the 👀 promised to read (§5.2) */
  drainedFromPostId?: string;
  /** §4.4 — the human whose further fragments this turn absorbs; absent on every other turn */
  foldAuthorUsername?: string;
  profile: AgentProfile;
  /** §7.4 — the human or trigger post this turn's chain descends from */
  rootPostId: string;
  triggeringPostId?: string;
};

/**
 * §5.3 — what an exhausted budget resolved to. `voice-only` is the reasoned denial: the turn keeps
 * running so the agent can answer, holding the human's reason, but every further action is refused.
 */
type Exhaustion = { kind: 'ended'; outcome: TurnOutcome } | { kind: 'extended' } | { kind: 'voice-only'; text: string };

/**
 * Where in the budget an admitted call sits, sampled where it was charged rather than where it
 * runs: a concurrent batch is admitted whole before any of it executes.
 */
type BudgetPosition = { readonly actionBudget: number; readonly actionNumber: number };

/** what admitting a call to the budget came to; an extension is spent inside admission and never surfaces */
type Admission = Exclude<Exhaustion, { kind: 'extended' }> | { kind: 'admitted'; position: BudgetPosition };

/** what a call resolves to, once: the structural name for the record, the display name for humans (§1) */
type CallIdentity = {
  readonly displayName: string;
  /** whether the name resolved to a tool this agent holds; only such a call may be forgiven its arguments (§7.2) */
  readonly isGranted: boolean;
  readonly recordedName: PrismaJson.RecordedToolName;
};

/** a call the executor may run, with the detail its tool renders for the status post */
type RunnableCall = CallIdentity & {
  readonly call: ToolCall;
  readonly detail: string | undefined;
  readonly kind: 'runnable';
};

/** a call whose arguments never parsed: answered or refused by the runner, never executed (§7.2) */
type UnparsedCall = CallIdentity & { readonly call: UnparsedToolCall; readonly kind: 'unparsed' };

type IdentifiedCall = RunnableCall | UnparsedCall;

/** what answering an unparsed call came to: forgiven and answered in place, or the dispatch loop returns with this outcome */
type UnparsedCallDisposition = { kind: 'dispatched'; outcome: TurnOutcome | undefined } | { kind: 'forgiven' };

/** §3.15 — what publishing a tool's post came to: landed, refused as a post (§4.5), or undeliverable, which ends the turn (§7.1) */
type ToolPostOutcome =
  | { kind: 'published'; postId: string }
  | { kind: 'refused'; output: string }
  | { kind: 'undelivered'; outcome: TurnOutcome };

/** §7.1 — the exits whose notice names the calls that may already have changed something */
type FailureStatus = Extract<
  TurnStatus,
  | 'context_exhausted'
  | 'delivery_failure'
  | 'provider_outage'
  | 'provider_rejected'
  | 'semantic_error'
  | 'side_effect_ambiguous'
>;

type TurnState = {
  /** §4.5 — the one peer this turn has addressed, whatever number of posts it emits */
  addressedPeer: string | undefined;
  readonly budget: ActionBudget;
  /** §7.1, §8.1 — by display name, how many times a call that may have taken effect ran to completion */
  readonly callsThatMayHaveTakenEffect: Map<string, number>;
  /** §4.5 — rejected posts and unknown tool names (§7.2) since the last call that ran */
  consecutiveRejections: number;
  readonly control: TurnControlHandle;
  readonly fold: TurnFoldHandle;
  readonly messages: CompletionMessage[];
  /** §3.8 — the estimated size of the whole outgoing request, kept current by `pushMessage` and the collapses */
  promptTokens: number;
  /** §7.1 — results this turn recorded; a turn that recorded none accumulated nothing a fresh one would not rebuild */
  recordedResults: number;
  /** §3.7 — resolved once, at turn setup, and quoted on every approval prompt the turn raises */
  readonly requestedBy: TurnRequest | undefined;
  readonly status: StatusPostHandle;
  /** the supersedable results still verbatim in `messages`, oldest first (§3.8) */
  readonly supersedable: { messageIndex: number; replay: string }[];
  readonly transport: ChatTransport;
  readonly turn: Turn;
  /** §7.2 — calls with unparseable arguments this turn has already forgiven */
  unparsedCalls: number;
  /** §3.8 — the first message the model has not read yet: a result at or past it is never collapsed or cut short */
  unreadFrom: number;
  usage: CompletionUsage | undefined;
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
  private readonly limits: TurnLimits;

  constructor(
    private readonly approvalsService: ApprovalsService,
    configService: ConfigService,
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
  ) {
    const turns = configService.get('turns');
    this.limits = {
      chainLengthLimit: turns.chainLengthLimit,
      delegationDepthLimit: turns.delegationDepthLimit,
      foldLimit: configService.get('activation.foldLimit')
    };
  }

  /** §7.4 — a turn the chain limit refuses at admission opens nothing: no row, no status post, no session */
  async run(input: RunInput): Promise<Result<TurnOutcome, TurnOpenFailure>> {
    const { channelId, profile } = input;
    const opened = await this.turnsService.open({
      agentUsername: profile.username,
      chainLength: input.chainLength,
      channelId,
      depth: input.depth,
      modelName: profile.model.name,
      rootPostId: input.rootPostId,
      triggeringPostId: input.triggeringPostId
    });
    if (!opened.success) {
      return opened;
    }
    const turn = opened.value;
    const state: TurnState = {
      addressedPeer: undefined,
      budget: new ActionBudget(profile.actionBudget),
      callsThatMayHaveTakenEffect: new Map(),
      consecutiveRejections: 0,
      control: this.turnControlRegistry.register(turn.id, channelId),
      fold: this.turnFoldRegistry.register({
        agentUsername: profile.username,
        authorUsername: input.foldAuthorUsername,
        channelId
      }),
      messages: [],
      promptTokens: 0,
      recordedResults: 0,
      requestedBy: await this.resolveRequester(input),
      status: this.statusPostService.open({ agentUsername: profile.username, channelId, turnId: turn.id }),
      supersedable: [],
      transport: this.transportRegistry.get(profile.username),
      turn,
      unparsedCalls: 0,
      unreadFrom: 0,
      usage: undefined
    };
    try {
      return Result.ok(await this.runLoop(input, state));
    } catch (error) {
      this.loggingService.error(
        new Error(`the turn for "${profile.username}" hit a framework error`, { cause: error })
      );
      return Result.ok(
        await this.closeWithFailureNotice(
          input,
          state,
          'semantic_error',
          renderSemanticErrorNotice('something went wrong inside the framework')
        )
      );
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

  /**
   * §7.5 — each steer spends an attempt, is kept on the trace, and reaches the model as the human
   * speaking, prefixed exactly as a post is. It is new information, so the count of rejected posts
   * starts again (§4.5). Returns the outcome where the budget ends the turn instead.
   */
  private async absorbSteering(
    input: RunInput,
    state: TurnState,
    taken: readonly Steering[]
  ): Promise<TurnOutcome | undefined> {
    for (const [index, steering] of taken.entries()) {
      let denial: string | undefined;
      if (state.budget.trySpendOnSteer() === 'exhausted') {
        const exhaustion = await this.handleExhaustion(input, state);
        if (exhaustion.kind === 'ended') {
          return exhaustion.outcome;
        }
        if (exhaustion.kind === 'voice-only') {
          denial = exhaustion.text;
        } else {
          state.budget.trySpendOnSteer();
        }
      }
      await this.turnsService.appendEvent(state.turn.id, { kind: 'steering_received', ...steering });
      this.pushMessage(state, { content: `@${steering.byUsername}: ${steering.text}`, role: 'user' });
      state.status.appendTrace(renderSteeringLine(steering.byUsername));
      state.consecutiveRejections = 0;
      if (denial !== undefined) {
        // the remaining steers are words the human said; they are heard, but no further attempt is spent
        for (const rest of taken.slice(index + 1)) {
          await this.turnsService.appendEvent(state.turn.id, { kind: 'steering_received', ...rest });
          this.pushMessage(state, { content: `@${rest.byUsername}: ${rest.text}`, role: 'user' });
          state.status.appendTrace(renderSteeringLine(rest.byUsername));
        }
        this.pushMessage(state, { content: denial, role: 'user' });
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * §5.3 — the abort check, the budget, and the trace line, in that order, before a call may run.
   * A voice-only denial is returned rather than answered here, because every call the completion
   * still holds is answered with it, not just this one.
   */
  private async admit(input: RunInput, state: TurnState, identified: IdentifiedCall): Promise<Admission> {
    // §7.5 — /stop means no further tool calls, including the rest of this completion's batch
    const aborted = state.control.aborted();
    if (aborted) {
      return { kind: 'ended', outcome: await this.close(state, aborted) };
    }
    const isExempt = this.toolRegistry.isBudgetExempt(input.profile, identified.call.name);
    if (state.budget.trySpend(isExempt) === 'exhausted') {
      const exhaustion = await this.handleExhaustion(input, state);
      if (exhaustion.kind !== 'extended') {
        return exhaustion;
      }
      state.budget.trySpend(isExempt);
    }
    state.status.appendTrace(
      renderToolCallLine(identified.displayName, identified.kind === 'runnable' ? identified.detail : undefined)
    );
    return {
      kind: 'admitted',
      position: { actionBudget: state.budget.limitCount, actionNumber: state.budget.spentCount }
    };
  }

  /**
   * §7.2 — a call naming no tool the agent holds is answered with the tools it does, and counts
   * toward §4.5's rejections in a row, so a model that keeps misnaming ends as refused output does.
   * The ending call is answered too, so the window can replay the completion that made it.
   */
  private async answerUnknownTool(
    input: RunInput,
    state: TurnState,
    identified: IdentifiedCall,
    output: string
  ): Promise<TurnOutcome | undefined> {
    await this.turnsService.appendEvent(state.turn.id, {
      callId: identified.call.id,
      kind: 'tool_result',
      output,
      toolName: identified.recordedName
    });
    if (state.consecutiveRejections >= CONSECUTIVE_REJECTION_LIMIT) {
      return this.closeWithFailureNotice(input, state, 'semantic_error', renderOutputRefusedNotice());
    }
    state.consecutiveRejections += 1;
    this.pushMessage(state, { content: output, role: 'tool', toolCallId: identified.call.id });
    return undefined;
  }

  /**
   * §5.3 — the reason arrives as the result of every call that did not run, so the completion's
   * batch is answered whole: a provider rejects an assistant message whose calls lack a result.
   */
  private async answerUnrun(state: TurnState, unrun: readonly IdentifiedCall[], text: string): Promise<void> {
    for (const identified of unrun) {
      await this.turnsService.appendEvent(state.turn.id, {
        callId: identified.call.id,
        kind: 'tool_result',
        output: text,
        toolName: identified.recordedName
      });
      this.pushMessage(state, { content: text, role: 'tool', toolCallId: identified.call.id });
    }
  }

  /** a post as the §4.5 grammar reads it: who wrote it, where, and whom it names */
  private asAddressablePost(input: RunInput, content: string) {
    return {
      authorUsername: input.profile.username,
      channelId: input.channelId,
      mentionedUsernames: extractMentionedUsernames(content)
    };
  }

  private ceilingFor(profile: AgentProfile): number {
    return Math.floor(profile.contextWindowTokens * TURN_PROMPT_CEILING_SHARE);
  }

  /** every exit but a §7.1 failure, which closes through `closeWithFailureNotice` */
  private close(state: TurnState, status: Exclude<TurnStatus, 'running' | FailureStatus>): Promise<TurnOutcome> {
    return this.writeClosingStatus(state, status);
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
      return this.closeWithFailureNotice(
        input,
        state,
        'semantic_error',
        renderSemanticErrorNotice('my reply could not be understood')
      );
    }
    if (failure.kind === 'context-overflow') {
      return this.closeWithFailureNotice(
        input,
        state,
        'context_exhausted',
        renderContextExhaustedNotice(state.recordedResults === 0 ? 'initial' : 'accumulated')
      );
    }
    if (failure.kind === 'provider') {
      return this.closeWithFailureNotice(
        input,
        state,
        'provider_rejected',
        renderProviderRejectionNotice(failure.status)
      );
    }
    return this.closeWithFailureNotice(input, state, 'provider_outage', renderProviderOutageNotice(failure));
  }

  private async closeOnToolFailure(
    input: RunInput,
    state: TurnState,
    identified: IdentifiedCall,
    attempt: ToolAttempt.Terminal
  ): Promise<TurnOutcome> {
    if (attempt.status === 'semantic_error' || attempt.status === 'side_effect_ambiguous') {
      await this.turnsService.appendEvent(state.turn.id, {
        callId: identified.call.id,
        kind: 'tool_result',
        output: attempt.detail,
        toolName: identified.recordedName
      });
    }
    return (
      match(attempt.status)
        .with('delivery_failure', (status) => {
          return this.closeWithFailureNotice(input, state, status, renderDeliveryFailureNotice());
        })
        .with('semantic_error', (status) => {
          return this.closeWithFailureNotice(input, state, status, renderSemanticErrorNotice(attempt.detail));
        })
        .with('side_effect_ambiguous', (status) => {
          return this.closeWithFailureNotice(
            input,
            state,
            status,
            renderSideEffectAmbiguityNotice(identified.displayName)
          );
        })
        .with('denied', async (status) => {
          await this.postNotice(input, state, renderDenialNotice());
          return this.close(state, status);
        })
        // §7.5 — a cancellation posts no follow-up; the command or halt already spoke
        .with('halted', 'killed', 'stopped', (status) => this.close(state, status))
        .exhaustive()
    );
  }

  /** §7.1 — the notice and what the turn may already have changed go out as one post, then the turn closes */
  private async closeWithFailureNotice(
    input: RunInput,
    state: TurnState,
    status: FailureStatus,
    notice: string
  ): Promise<TurnOutcome> {
    const { callsThatMayHaveTakenEffect } = state;
    await this.postNotice(
      input,
      state,
      callsThatMayHaveTakenEffect.size === 0
        ? notice
        : `${notice}\n${renderMayHaveTakenEffectLine(callsThatMayHaveTakenEffect)}`
    );
    return this.writeClosingStatus(state, status);
  }

  /**
   * The final completion is recorded as an event whether or not it posts: with its reasoning, it is
   * what the window replays, and the post is only the channel's copy. A reply that could not be
   * posted is not a completion — §7.1 defines normal completion as visible as the final post — so
   * the turn closes as a delivery failure, a non-progress exit.
   */
  private async closeWithFinalOutput(
    input: RunInput,
    state: TurnState,
    content: string,
    reasoning: CompletionReasoning
  ): Promise<TurnOutcome> {
    await this.turnsService.appendEvent(state.turn.id, {
      content,
      kind: 'assistant_message',
      toolCalls: [],
      ...reasoning
    });
    const sent = await this.publish(input, state, content, 'reply');
    if (!sent.success) {
      this.loggingService.error(new Error(`failed to post final output: ${sent.error.message}`));
      return this.closeWithFailureNotice(input, state, 'delivery_failure', renderDeliveryFailureNotice());
    }
    return this.close(state, 'completed');
  }

  /** §3.8 — the oldest verbatim page reads as its replay line for the rest of the turn; the event keeps the text */
  private collapseOldestSupersedable(state: TurnState): void {
    const stale = state.supersedable.shift()!;
    const message = state.messages[stale.messageIndex]!;
    const collapsed = { ...message, content: stale.replay };
    state.messages[stale.messageIndex] = collapsed;
    state.promptTokens += estimateMessageTokens(collapsed) - estimateMessageTokens(message);
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
      return await Promise.race([
        client.complete({ ...request, messages: state.messages }, { signal: state.control.killSignal }),
        state.control.killed
      ]);
    } finally {
      typing.stop();
    }
  }

  /**
   * The branch with no tool call: the turn's final output when it may post, else fed back as a
   * user message for another try under the budget — this branch carries no tool call for a tool
   * result to reference (§4.5). Output cut at the provider's limit takes the same loop (§7.1).
   */
  private async concludeOrRetry(
    input: RunInput,
    state: TurnState,
    completion: CompletionResult.Text | CompletionResult.Truncated
  ): Promise<TurnOutcome | undefined> {
    const truncated = completion.kind === 'truncated';
    const content = truncated ? completion.content : await this.enforceChainLimits(input, state, completion.content);
    let rejection = truncated ? TRUNCATED_OUTPUT_REJECTION : await this.rejectionOf(input, state, content);
    const reasoning = reasoningOf(completion);
    if (rejection === undefined) {
      return this.closeWithFinalOutput(input, state, content, reasoning);
    }
    // checked before the spend: the rejection that ends the turn buys nothing, so it costs nothing
    if (state.consecutiveRejections >= CONSECUTIVE_REJECTION_LIMIT) {
      return this.closeWithFailureNotice(input, state, 'semantic_error', renderOutputRefusedNotice());
    }
    state.consecutiveRejections += 1;
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
    if (content !== '') {
      this.pushMessage(state, { content, role: 'assistant', ...reasoning });
    }
    this.pushMessage(state, { content: rejection, role: 'user' });
    return undefined;
  }

  private createTurnScope(input: RunInput, state: TurnState): ToolTurnScope {
    return {
      agentUsername: input.profile.username,
      channelId: input.channelId,
      triggeringPostId: input.triggeringPostId ?? null,
      turnId: state.turn.id
    };
  }

  /**
   * §3.8 — the newest result cut to what fits beneath the ceiling, marker included, or left alone
   * when what would fit is not worth keeping. Escaping can lengthen a cut, so the cut is remeasured.
   */
  private cutResultToFit(state: TurnState, index: number, ceiling: number): boolean {
    const original = state.messages[index]!;
    const rest = state.promptTokens - estimateMessageTokens(original);
    const overhead = estimateMessageTokens({ ...original, content: RESULT_TRUNCATION_MARKER });
    let kept = (ceiling - rest - overhead) * CHARS_PER_TOKEN;
    for (;;) {
      if (kept < RESULT_MIN_TOKENS * CHARS_PER_TOKEN) {
        return false;
      }
      const cut = { ...original, content: `${original.content.slice(0, kept)}${RESULT_TRUNCATION_MARKER}` };
      const excess = rest + estimateMessageTokens(cut) - ceiling;
      if (excess <= 0) {
        state.messages[index] = cut;
        state.promptTokens = rest + estimateMessageTokens(cut);
        return true;
      }
      kept -= excess * CHARS_PER_TOKEN;
    }
  }

  /** §3 — the tool returned the disclosure; the turn owns writing the event the trace reads back */
  private async discloseRecord(
    state: TurnState,
    disclosure: NonNullable<ToolAttempt.Continue['disclosure']>
  ): Promise<void> {
    await this.turnsService.appendEvent(state.turn.id, {
      body: disclosure.body,
      description: disclosure.description,
      kind: 'record_written',
      reference: disclosure.reference,
      ...(disclosure.revisionOf !== undefined && { revisionOf: disclosure.revisionOf }),
      supersededDescriptions: [...(disclosure.supersededDescriptions ?? [])]
    });
  }

  /**
   * Batch by batch: a run of concurrent calls executes together, any other call alone. Every call
   * of a batch is admitted before the batch starts, so the budget prompt still blocks in order,
   * and its results are recorded in the order the model made the calls.
   */
  private async dispatchToolCalls(
    input: RunInput,
    state: TurnState,
    completion: CompletionResult.ToolUse
  ): Promise<TurnOutcome | undefined> {
    const calls = completion.toolCalls.map((call) => this.identify(input, call));
    const reasoning = reasoningOf(completion);
    await this.turnsService.appendEvent(state.turn.id, {
      content: completion.content,
      kind: 'assistant_message',
      toolCalls: calls.map(({ call, recordedName }) => ({
        args: toReplayableToolCall(call).arguments,
        callId: call.id,
        toolName: recordedName
      })),
      ...reasoning
    });
    this.pushMessage(state, {
      content: completion.content,
      role: 'assistant',
      toolCalls: completion.toolCalls.map(toReplayableToolCall),
      ...reasoning
    });
    state.unreadFrom = state.messages.length;
    if (completion.content !== '') {
      state.status.setTransient(this.multiMentionPolicy.stripAgentMentions(completion.content));
    }
    for (let position = 0; position < calls.length;) {
      const first = calls[position]!;
      if (first.kind === 'unparsed') {
        const disposition = await this.forgiveUnparsedCall(input, state, calls, position, first);
        if (disposition.kind === 'dispatched') {
          return disposition.outcome;
        }
        position += 1;
        continue;
      }
      const batch = this.takeBatch(input, first, calls.slice(position + 1));
      const positions: BudgetPosition[] = [];
      for (const identified of batch) {
        const admission = await this.admit(input, state, identified);
        if (admission.kind === 'ended') {
          return admission.outcome;
        }
        if (admission.kind === 'voice-only') {
          await this.answerUnrun(state, calls.slice(position), admission.text);
          return undefined;
        }
        positions.push(admission.position);
      }
      const attempts = await Promise.race([
        Promise.all(
          batch.map((identified, index) => {
            return this.toolExecutor.execute({
              appendEvent: (event) => this.turnsService.appendEvent(state.turn.id, event),
              call: identified.call,
              contextText: renderApprovalContext({ ...positions[index]!, requestedBy: state.requestedBy }),
              profile: input.profile,
              turn: this.createTurnScope(input, state)
            });
          })
        ),
        state.control.killed
      ]);
      if (attempts === 'killed') {
        return this.close(state, 'killed');
      }
      for (const [index, attempt] of attempts.entries()) {
        const outcome = await this.recordAttempt(input, state, batch[index]!, attempt);
        if (outcome) {
          return outcome;
        }
      }
      position += batch.length;
    }
    return undefined;
  }

  /**
   * §7.4 — at either limit the output still posts, but with its agent mentions stripped so it
   * cannot activate anyone, and a fixed notice tells the humans why the chain stopped here. Chain
   * length is checked first: it is the limit a human lifts by posting, so its notice is the one
   * that says what to do. The chain is counted by its root, this turn's own row included, so the
   * early stop fires at the same number admission would refuse the next turn at.
   */
  private async enforceChainLimits(input: RunInput, state: TurnState, content: string): Promise<string> {
    const atChainLengthLimit = (await this.turnsService.countInChain(input.rootPostId)) >= this.limits.chainLengthLimit;
    if (!atChainLengthLimit && input.depth < this.limits.delegationDepthLimit) {
      return content;
    }
    const stripped = this.multiMentionPolicy.stripAgentMentions(content);
    if (stripped !== content) {
      await this.postNotice(
        input,
        state,
        atChainLengthLimit ? renderChainLengthLimitNotice() : renderDelegationLimitNotice()
      );
    }
    return stripped;
  }

  private exceedsCeiling(input: RunInput, state: TurnState): boolean {
    return state.promptTokens > this.ceilingFor(input.profile);
  }

  /**
   * §7.2 — a granted tool's arguments that never parsed are answered once, spending an attempt like
   * any invocation, without the tool ever seeing them; the second in a turn ends the turn as the
   * semantic error it always was. A call naming no tool the agent holds is answered as its name.
   */
  private async forgiveUnparsedCall(
    input: RunInput,
    state: TurnState,
    calls: readonly IdentifiedCall[],
    position: number,
    identified: UnparsedCall
  ): Promise<UnparsedCallDisposition> {
    if (!identified.isGranted) {
      const admission = await this.admit(input, state, identified);
      if (admission.kind === 'ended') {
        return { kind: 'dispatched', outcome: admission.outcome };
      }
      if (admission.kind === 'voice-only') {
        await this.answerUnrun(state, calls.slice(position), admission.text);
        return { kind: 'dispatched', outcome: undefined };
      }
      const outcome = await this.answerUnknownTool(
        input,
        state,
        identified,
        this.toolRegistry.renderUnknownToolResult(input.profile, identified.call.name)
      );
      return outcome ? { kind: 'dispatched', outcome } : { kind: 'forgiven' };
    }
    if (state.unparsedCalls >= UNPARSED_CALL_LIMIT) {
      const outcome = await this.closeWithFailureNotice(
        input,
        state,
        'semantic_error',
        renderSemanticErrorNotice('a tool call I made could not be read')
      );
      return { kind: 'dispatched', outcome };
    }
    state.unparsedCalls += 1;
    this.loggingService.warn(
      `"${input.profile.username}" called ${identified.displayName} with arguments that did not parse, forgiven once (${input.profile.model.provider}/${input.profile.model.name})`
    );
    const admission = await this.admit(input, state, identified);
    if (admission.kind === 'ended') {
      return { kind: 'dispatched', outcome: admission.outcome };
    }
    if (admission.kind === 'voice-only') {
      await this.answerUnrun(state, calls.slice(position), admission.text);
      return { kind: 'dispatched', outcome: undefined };
    }
    await this.turnsService.appendEvent(state.turn.id, {
      callId: identified.call.id,
      kind: 'tool_result',
      output: UNPARSED_ARGUMENTS_RESULT,
      rawArgumentsPreview: identified.call.rawArguments.slice(0, RAW_ARGUMENTS_PREVIEW_CHARS),
      toolName: identified.recordedName
    });
    this.pushMessage(state, { content: UNPARSED_ARGUMENTS_RESULT, role: 'tool', toolCallId: identified.call.id });
    state.consecutiveRejections = 0;
    return { kind: 'forgiven' };
  }

  /**
   * §5.3 — on exhaustion the turn blocks on an approval to extend. Approving grants a further batch of
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
      payloadText: renderExtensionPrompt({
        attemptsSoFar: state.budget.spentCount,
        extensionNumber,
        grant: state.budget.baseCount
      }),
      toolName: 'extend_budget',
      toolNamespace: null,
      turnId: state.turn.id
    });
    if (!decision.success) {
      return {
        kind: 'ended',
        outcome: await this.closeWithFailureNotice(input, state, 'delivery_failure', renderDeliveryFailureNotice())
      };
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

  /** whether the oldest verbatim page is one the model has already read, so collapsing it loses nothing unseen */
  private hasReadSupersedable(state: TurnState): boolean {
    const oldest = state.supersedable[0];
    return oldest !== undefined && oldest.messageIndex < state.unreadFrom;
  }

  /**
   * §8.1 — resolved before anything runs, so the arguments are still raw model output: a call the
   * executor will reject as unknown keeps the name the model wrote, and one with malformed
   * arguments describes itself by name alone.
   */
  private identify(input: RunInput, call: ToolCall | UnparsedToolCall): IdentifiedCall {
    const args = isUnparsedToolCall(call) ? {} : call.arguments;
    const described = this.toolRegistry.describeCall({ args, name: call.name, profile: input.profile });
    const identity: CallIdentity = {
      displayName: described?.displayName ?? call.name,
      isGranted: described !== undefined,
      recordedName: described?.id ?? call.name
    };
    if (isUnparsedToolCall(call)) {
      return { ...identity, call, kind: 'unparsed' };
    }
    return { ...identity, call, detail: described?.detail, kind: 'runnable' };
  }

  /** §3.8 — the request as assembled is measured whole; everything pushed afterwards adds its own estimate */
  private loadAssembledContext(state: TurnState, assembled: AssembledContext): void {
    state.messages.splice(0, state.messages.length, ...assembled.request.messages);
    state.promptTokens = estimateRequestTokens({ ...assembled.request, messages: state.messages });
  }

  /**
   * §4.5 — a post over the substrate's limit (§6.2) is refused, never truncated. The limit counts
   * characters as Mattermost does, by code point. Where it cannot be read, the post is attempted as
   * it stands and the substrate decides.
   */
  private async measureAgainstPostLimit(
    state: TurnState,
    text: string
  ): Promise<undefined | { length: number; limit: number }> {
    const limit = await state.transport.maxPostSizeChars();
    if (!limit.success) {
      this.loggingService.warn(`could not read MaxPostSize to bound a post: ${limit.error.message}`);
      return undefined;
    }
    const length = Array.from(text).length;
    return length > limit.value ? { length, limit: limit.value } : undefined;
  }

  /** §5.2 — checked on every assembly, since a fold rebuilds the window and can lose the reach the first one had */
  private noteShortfall(input: RunInput, state: TurnState, assembled: AssembledContext): void {
    if (input.drainedFromPostId !== undefined && !assembled.windowPostIds.has(input.drainedFromPostId)) {
      state.status.appendTrace(renderContextShortfallLine());
    }
  }

  /** §7.1's human-visible notices: deterministic strings posted under the agent's name (§3.2) */
  private async postNotice(input: RunInput, state: TurnState, text: string): Promise<void> {
    try {
      const sent = await this.publish(input, state, text, 'notice');
      if (!sent.success) {
        this.loggingService.error(new Error(`failed to post a turn notice: ${sent.error.message}`));
      }
    } catch (error) {
      this.loggingService.error(new Error('failed to record a turn notice', { cause: error }));
    }
  }

  /**
   * The one door onto the channel for a turn's own posts: sent under the agent's account, recorded
   * with the turn that authored it, and the peer it addresses remembered for the rest of the turn
   * (§4.5). The record is what makes a later return recognisable (§7.4).
   */
  private async publish(
    input: RunInput,
    state: TurnState,
    text: string,
    kind: Exclude<PostKind, 'message'>
  ): Promise<Result<{ postId: string }, { message: string }>> {
    const sent = await state.transport.send({ channelId: input.channelId, text });
    if (!sent.success) {
      return sent;
    }
    state.addressedPeer =
      this.multiMentionPolicy.addresseesOf(this.asAddressablePost(input, text))[0] ?? state.addressedPeer;
    await this.conversationsService.record(
      {
        attachments: [],
        authorKind: 'agent',
        authorUsername: input.profile.username,
        channelId: input.channelId,
        createdAt: sent.value.createdAt,
        id: sent.value.postId,
        message: text
      },
      { kind, turnId: state.turn.id }
    );
    return Result.ok({ postId: sent.value.postId });
  }

  /**
   * §3.15 — the post comes first: refused as any post is (§4.5), the refusal becomes the call's
   * result and the tool writes nothing; undeliverable, the turn ends as it would for its own final
   * output (§7.1); landed and recorded, the tool is told, and only then writes.
   */
  private async publishToolPost(input: RunInput, state: TurnState, post: ToolPost): Promise<ToolPostOutcome> {
    const text = this.multiMentionPolicy.stripAgentMentionsExcept(post.text, post.addressee);
    const addressable = this.asAddressablePost(input, text);
    if (this.multiMentionPolicy.refuses(addressable)) {
      return { kind: 'refused', output: 'post refused: it addresses more than one colleague' };
    }
    if (this.multiMentionPolicy.refusesSecondAddressee(addressable, state.addressedPeer)) {
      return { kind: 'refused', output: `post refused: this turn has already addressed @${state.addressedPeer}` };
    }
    const oversize = await this.measureAgainstPostLimit(state, text);
    if (oversize) {
      return {
        kind: 'refused',
        output: `post refused: it is ${oversize.length} characters and a post holds at most ${oversize.limit} — shorten what you pass`
      };
    }
    const sent = await this.publish(input, state, text, 'notice');
    if (!sent.success) {
      this.loggingService.error(new Error(`failed to publish a tool post: ${sent.error.message}`));
      return {
        kind: 'undelivered',
        outcome: await this.closeWithFailureNotice(input, state, 'delivery_failure', renderDeliveryFailureNotice())
      };
    }
    return { kind: 'published', postId: sent.value.postId };
  }

  /** §3.8 — the one door onto `messages`: every push adds its estimate, so the number cannot drift */
  private pushMessage(state: TurnState, message: CompletionMessage): void {
    state.messages.push(message);
    state.promptTokens += estimateMessageTokens(message);
  }

  /** the result the model reads, the event the trace keeps, and the lines the status post shows */
  private async recordAttempt(
    input: RunInput,
    state: TurnState,
    identified: IdentifiedCall,
    attempt: ToolAttempt
  ): Promise<TurnOutcome | undefined> {
    if (attempt.kind === 'terminal') {
      return this.closeOnToolFailure(input, state, identified, attempt);
    }
    if (attempt.kind === 'unknown-tool') {
      return this.answerUnknownTool(input, state, identified, attempt.output);
    }
    state.consecutiveRejections = 0;
    const published = attempt.post === undefined ? undefined : await this.publishToolPost(input, state, attempt.post);
    if (published?.kind === 'undelivered') {
      return published.outcome;
    }
    const result = published?.kind === 'refused' ? { kind: 'continue' as const, output: published.output } : attempt;
    if (result.mayHaveTakenEffect) {
      const { callsThatMayHaveTakenEffect: counts } = state;
      counts.set(identified.displayName, (counts.get(identified.displayName) ?? 0) + 1);
    }
    await this.turnsService.appendEvent(state.turn.id, {
      callId: identified.call.id,
      kind: 'tool_result',
      output: result.output,
      toolName: identified.recordedName,
      ...(result.replay !== undefined && { replay: result.replay })
    });
    this.pushMessage(state, { content: result.output, role: 'tool', toolCallId: identified.call.id });
    state.recordedResults += 1;
    this.supersedeStaleResults(input, state, identified, result.replay);
    if (published?.kind === 'published' && attempt.post) {
      await attempt.post.onPublished(published.postId);
    }
    if (result.disclosure) {
      await this.discloseRecord(state, result.disclosure);
    }
    if (this.relieveContextPressure(input, state) === 'exhausted') {
      return this.closeWithFailureNotice(
        input,
        state,
        'context_exhausted',
        renderContextExhaustedNotice('accumulated')
      );
    }
    return undefined;
  }

  /**
   * Why a final output cannot post as-is, or nothing. None is a semantic failure: the model
   * produced valid output that breaks a framework rule it cannot see (§4.5), wrote a tool call as
   * text where only a real call runs anything, or wrote more than a post holds, and one retry is
   * cheap in every case.
   */
  private async rejectionOf(input: RunInput, state: TurnState, content: string): Promise<string | undefined> {
    const post = this.asAddressablePost(input, content);
    if (this.multiMentionPolicy.refuses(post)) {
      return 'post rejected: multiple agent mentions';
    }
    if (this.multiMentionPolicy.refusesSecondAddressee(post, state.addressedPeer)) {
      return `post rejected: this turn has already addressed @${state.addressedPeer}`;
    }
    if (containsToolCallTranscript(content)) {
      return 'post rejected: a tool call written as text runs nothing — invoke the tool instead';
    }
    const oversize = await this.measureAgainstPostLimit(state, content);
    if (oversize) {
      return `post rejected: the reply is ${oversize.length} characters and a post holds at most ${oversize.limit} — answer more briefly, or post the first part and say what remains`;
    }
    return undefined;
  }

  /**
   * §3.8 — under pressure the count rule relaxes: stale pages collapse however recent they are, but
   * never a result the model has not read; the newest result, if it still does not fit, is cut.
   * Only when even that leaves the turn over its ceiling is it out of room.
   */
  private relieveContextPressure(input: RunInput, state: TurnState): 'exhausted' | 'relieved' {
    const ceiling = this.ceilingFor(input.profile);
    while (state.promptTokens > ceiling && this.hasReadSupersedable(state)) {
      this.collapseOldestSupersedable(state);
    }
    if (state.promptTokens <= ceiling) {
      return 'relieved';
    }
    return this.cutResultToFit(state, state.messages.length - 1, ceiling) ? 'relieved' : 'exhausted';
  }

  /**
   * §3.7 — who asked, read once per turn. Peer mentions lose their @ before the words can be
   * quoted back, because an approval prompt repeating one would address that peer (§4.5).
   */
  private async resolveRequester(input: RunInput): Promise<TurnRequest | undefined> {
    if (input.triggeringPostId === undefined) {
      return undefined;
    }
    const request = await this.conversationsService.findRequester(input.triggeringPostId);
    if (request?.kind !== 'human') {
      return request;
    }
    return { ...request, message: this.multiMentionPolicy.stripAgentMentions(request.message) };
  }

  /** everything here may throw; run() owns the boundary so no exit can leave the turn 'running' */
  private async runLoop(input: RunInput, state: TurnState): Promise<TurnOutcome> {
    const { channelId, profile } = input;
    let assembled = await this.contextAssembler.assemble({ channelId, profile });
    this.loadAssembledContext(state, assembled);
    this.noteShortfall(input, state, assembled);
    if (this.exceedsCeiling(input, state)) {
      return this.closeWithFailureNotice(input, state, 'context_exhausted', renderContextExhaustedNotice('initial'));
    }
    const client = this.inferenceRegistry.getClientForModel(profile.model);
    let folds = 0;
    for (;;) {
      const steered = await this.absorbSteering(input, state, state.control.takeSteering());
      if (steered) {
        return steered;
      }
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
        state.usage = addCompletionUsage(state.usage, completion.value.usage);
      }
      if (this.takesFurtherFragments(state, folds)) {
        folds += 1;
        assembled = await this.contextAssembler.assemble({ channelId, profile });
        this.loadAssembledContext(state, assembled);
        this.noteShortfall(input, state, assembled);
        if (this.exceedsCeiling(input, state)) {
          return this.closeWithFailureNotice(
            input,
            state,
            'context_exhausted',
            renderContextExhaustedNotice('initial')
          );
        }
        continue;
      }
      // §7.5 — a completion made before the correction is thrown away unrecorded and unexecuted,
      // as §4.4 throws away the completion that only saw half a request
      const arrived = state.control.takeSteering();
      if (arrived.length > 0) {
        const steeredLate = await this.absorbSteering(input, state, arrived);
        if (steeredLate) {
          return steeredLate;
        }
        continue;
      }
      const outcome =
        completion.value.kind === 'tool-use'
          ? await this.dispatchToolCalls(input, state, completion.value)
          : await this.concludeOrRetry(input, state, completion.value);
      if (outcome) {
        return outcome;
      }
    }
  }

  /**
   * §3.8 — past the retained few, an earlier page reads as its replay line for the rest of the
   * turn; the event keeps the text, so the trace and the window's own replay are untouched.
   */
  private supersedeStaleResults(
    input: RunInput,
    state: TurnState,
    identified: IdentifiedCall,
    replay: string | undefined
  ): void {
    if (!this.toolRegistry.isSupersedable(input.profile, identified.call.name)) {
      return;
    }
    state.supersedable.push({
      messageIndex: state.messages.length - 1,
      replay: replay ?? renderReplayLine(`earlier ${identified.call.name} result`)
    });
    while (state.supersedable.length > RETAINED_SUPERSEDABLE_RESULTS && this.hasReadSupersedable(state)) {
      this.collapseOldestSupersedable(state);
    }
  }

  /**
   * §5.1 — the calls that may run together: a run of concurrent calls, or the first alone. A call
   * that will not run (§7.2) closes the run, having no place in a batch whose ordering means something.
   */
  private takeBatch(input: RunInput, first: RunnableCall, rest: readonly IdentifiedCall[]): RunnableCall[] {
    const runsConcurrently = (identified: RunnableCall) => {
      return this.toolRegistry.isConcurrent(input.profile, identified.call.name);
    };
    const batch = [first];
    if (!runsConcurrently(first)) {
      return batch;
    }
    for (const next of rest) {
      if (next.kind === 'unparsed' || !runsConcurrently(next)) {
        break;
      }
      batch.push(next);
    }
    return batch;
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
    const takes = state.fold.takeOffered().length > 0 && folds < this.limits.foldLimit;
    if (!takes || folds + 1 >= this.limits.foldLimit) {
      state.fold.stopAbsorbing();
    }
    return takes;
  }

  /** best-effort on both writes: a close that itself fails must never leave the turn 'running' silently */
  private async writeClosingStatus(state: TurnState, status: Exclude<TurnStatus, 'running'>): Promise<TurnOutcome> {
    try {
      await state.status.close(status, state.callsThatMayHaveTakenEffect);
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
}
