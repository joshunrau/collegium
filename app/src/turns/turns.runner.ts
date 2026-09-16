import type { ToolTurnScope } from '@collegium/core/tools';
import type { Result } from '@collegium/core/utils';
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
import type { InferenceClient } from '@/inference/inference.client.ts';
import { InferenceRegistry } from '@/inference/inference.registry.ts';
import type {
  CompletionMessage,
  CompletionReasoning,
  CompletionRequest,
  CompletionResult,
  CompletionUsage,
  InferenceFailure,
  ToolCall
} from '@/inference/inference.types.ts';
import { addCompletionUsage, describeInferenceFailure, reasoningOf } from '@/inference/inference.utils.ts';
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
import { containsToolCallTranscript } from './context/context.utils.ts';
import { TurnControlRegistry } from './control/turn-control.registry.ts';
import { TurnFoldRegistry } from './folding/turn-fold.registry.ts';
import {
  renderBudgetExhaustedNotice,
  renderChainLengthLimitNotice,
  renderContextShortfallLine,
  renderDelegationLimitNotice,
  renderDeliveryFailureNotice,
  renderDenialNotice,
  renderExtensionPrompt,
  renderProviderOutageNotice,
  renderProviderRejectionNotice,
  renderRecordDeletedLine,
  renderRecordWriteLine,
  renderSemanticErrorNotice,
  renderSideEffectAmbiguityNotice,
  renderSupersededLine,
  renderToolCallLine
} from './status/status-post.renderer.ts';
import { StatusPostService } from './status/status-post.service.ts';
import { TurnsService } from './turns.service.ts';
import { TypingIndicatorService } from './typing/typing-indicator.service.ts';

import type { AssembledContext } from './context/context.assembler.ts';
import type { TurnControlHandle } from './control/turn-control.registry.ts';
import type { TurnFoldHandle } from './folding/turn-fold.registry.ts';
import type { StatusPostHandle } from './status/status-post.service.ts';
import type { Turn, TurnOutcome } from './turns.types.ts';

/** §3.8 — how many of a turn's supersedable results stay verbatim; the rest read as their replay line */
const RETAINED_SUPERSEDABLE_RESULTS = 2;

/** §7.1 — what a completion cut at the output limit hears; the loop it re-enters is the rejected post's (§4.5) */
const TRUNCATED_OUTPUT_REJECTION =
  'output rejected: it was cut off at the output limit before it finished — answer more briefly, or do the work in smaller steps';

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
  triggeringPostId?: string;
};

/**
 * §5.3 — what an exhausted budget resolved to. `voice-only` is the reasoned denial: the turn keeps
 * running so the agent can answer, holding the human's reason, but every further action is refused.
 */
type Exhaustion = { kind: 'ended'; outcome: TurnOutcome } | { kind: 'extended' } | { kind: 'voice-only'; text: string };

/** what admitting a call to the budget came to; an extension is spent inside admission and never surfaces */
type Admission = Exclude<Exhaustion, { kind: 'extended' }> | { kind: 'admitted' };

/** one call of a completion, resolved once: the structural name for the record, the display name for humans (§1) */
type IdentifiedCall = {
  readonly call: ToolCall;
  readonly detail: string | undefined;
  readonly displayName: string;
  readonly recordedName: PrismaJson.RecordedToolName;
};

type TurnState = {
  readonly budget: ActionBudget;
  readonly control: TurnControlHandle;
  readonly fold: TurnFoldHandle;
  readonly messages: CompletionMessage[];
  readonly status: StatusPostHandle;
  /** the supersedable results still verbatim in `messages`, oldest first (§3.8) */
  readonly supersedable: { messageIndex: number; replay: string }[];
  readonly transport: ChatTransport;
  readonly turn: Turn;
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

  async run(input: RunInput): Promise<TurnOutcome> {
    const { channelId, profile } = input;
    const turn = await this.turnsService.open({
      agentUsername: profile.username,
      chainLength: input.chainLength,
      channelId,
      depth: input.depth,
      modelName: profile.model.name,
      triggeringPostId: input.triggeringPostId
    });
    const state: TurnState = {
      budget: new ActionBudget(profile.actionBudget),
      control: this.turnControlRegistry.register(turn.id, channelId),
      fold: this.turnFoldRegistry.register({
        agentUsername: profile.username,
        authorUsername: input.foldAuthorUsername,
        channelId
      }),
      messages: [],
      status: this.statusPostService.open({ agentUsername: profile.username, channelId, turnId: turn.id }),
      supersedable: [],
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
    state.status.appendTrace(renderToolCallLine(identified.displayName, identified.detail));
    return { kind: 'admitted' };
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
      state.messages.push({ content: text, role: 'tool', toolCallId: identified.call.id });
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
    if (failure.kind === 'provider') {
      await this.postNotice(input, state, renderProviderRejectionNotice(failure.status));
      return this.close(state, 'provider_rejected');
    }
    await this.postNotice(input, state, renderProviderOutageNotice(failure));
    return this.close(state, 'provider_outage');
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
    const notice = match(attempt.status)
      .with('delivery_failure', () => renderDeliveryFailureNotice())
      .with('denied', () => renderDenialNotice())
      .with('semantic_error', () => renderSemanticErrorNotice(attempt.detail))
      .with('side_effect_ambiguous', () => renderSideEffectAmbiguityNotice(identified.displayName))
      // §7.5 — a cancellation posts no follow-up; the command or halt already spoke
      .with('halted', 'killed', 'stopped', () => undefined)
      .exhaustive();
    if (notice !== undefined) {
      await this.postNotice(input, state, notice);
    }
    return this.close(state, attempt.status);
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
    const sent = await state.transport.send({ channelId: input.channelId, text: content });
    if (!sent.success) {
      this.loggingService.error(new Error(`failed to post final output: ${sent.error.message}`));
      return this.close(state, 'delivery_failure');
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
      { kind: 'reply', turnId: state.turn.id }
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
    let rejection = truncated ? TRUNCATED_OUTPUT_REJECTION : this.rejectionOf(input, content);
    const reasoning = reasoningOf(completion);
    if (rejection === undefined) {
      return this.closeWithFinalOutput(input, state, content, reasoning);
    }
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
      state.messages.push({ content, role: 'assistant', ...reasoning });
    }
    state.messages.push({ content: rejection, role: 'user' });
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

  /** §3 — the tool returned the disclosure; the turn owns writing the event and the trace lines */
  private async discloseRecord(
    state: TurnState,
    disclosure: NonNullable<ToolAttempt.Continue['disclosure']>
  ): Promise<void> {
    await this.turnsService.appendEvent(state.turn.id, {
      body: disclosure.body,
      description: disclosure.description,
      kind: 'record_written',
      reference: disclosure.reference,
      supersededDescriptions: [...(disclosure.supersededDescriptions ?? [])]
    });
    state.status.appendTrace(renderRecordWriteLine(disclosure));
    for (const superseded of disclosure.supersededDescriptions ?? []) {
      state.status.appendTrace(renderSupersededLine(superseded));
    }
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
        args: call.arguments,
        callId: call.id,
        toolName: recordedName
      })),
      ...reasoning
    });
    state.messages.push({
      content: completion.content,
      role: 'assistant',
      toolCalls: completion.toolCalls,
      ...reasoning
    });
    if (completion.content !== '') {
      state.status.setTransient(this.multiMentionPolicy.stripAgentMentions(completion.content));
    }
    for (let position = 0; position < calls.length;) {
      const batch = this.takeBatch(input, calls, position);
      for (const identified of batch) {
        const admission = await this.admit(input, state, identified);
        if (admission.kind === 'ended') {
          return admission.outcome;
        }
        if (admission.kind === 'voice-only') {
          await this.answerUnrun(state, calls.slice(position), admission.text);
          return undefined;
        }
      }
      const attempts = await Promise.race([
        Promise.all(
          batch.map((identified) => {
            return this.toolExecutor.execute({
              appendEvent: (event) => this.turnsService.appendEvent(state.turn.id, event),
              call: identified.call,
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
   * that says what to do.
   */
  private async enforceChainLimits(input: RunInput, state: TurnState, content: string): Promise<string> {
    const atChainLengthLimit = input.chainLength >= this.limits.chainLengthLimit;
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
      return { kind: 'ended', outcome: await this.close(state, 'delivery_failure') };
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

  /**
   * §8.1 — resolved before anything runs, so the arguments are still raw model output: a call the
   * executor will reject as unknown keeps the name the model wrote, and one with malformed
   * arguments describes itself by name alone.
   */
  private identify(input: RunInput, call: ToolCall): IdentifiedCall {
    const described = this.toolRegistry.describeCall({ args: call.arguments, name: call.name, profile: input.profile });
    return {
      call,
      detail: described?.detail,
      displayName: described?.displayName ?? call.name,
      recordedName: described?.id ?? call.name
    };
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
        { kind: 'notice', turnId: state.turn.id }
      );
    } catch (error) {
      this.loggingService.error(new Error('failed to record a turn notice', { cause: error }));
    }
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
    await this.turnsService.appendEvent(state.turn.id, {
      callId: identified.call.id,
      kind: 'tool_result',
      output: attempt.output,
      toolName: identified.recordedName,
      ...(attempt.replay !== undefined && { replay: attempt.replay })
    });
    state.messages.push({ content: attempt.output, role: 'tool', toolCallId: identified.call.id });
    this.supersedeStaleResults(input, state, identified, attempt.replay);
    if (attempt.disclosure) {
      await this.discloseRecord(state, attempt.disclosure);
    }
    if (attempt.deletedDescription !== undefined) {
      state.status.appendTrace(renderRecordDeletedLine(attempt.deletedDescription));
    }
    return undefined;
  }

  /**
   * Why a final output cannot post as-is, or nothing. Neither is a semantic failure: the model
   * produced valid output that breaks a framework rule it cannot see (§4.5), or wrote a tool call
   * as text where only a real call runs anything, and one retry is cheap either way.
   */
  private rejectionOf(input: RunInput, content: string): string | undefined {
    const refused = this.multiMentionPolicy.refuses({
      authorUsername: input.profile.username,
      channelId: input.channelId,
      mentionedUsernames: extractMentionedUsernames(content)
    });
    if (refused) {
      return 'post rejected: multiple agent mentions';
    }
    if (containsToolCallTranscript(content)) {
      return 'post rejected: a tool call written as text runs nothing — invoke the tool instead';
    }
    return undefined;
  }

  /** everything here may throw; run() owns the boundary so no exit can leave the turn 'running' */
  private async runLoop(input: RunInput, state: TurnState): Promise<TurnOutcome> {
    const { channelId, profile } = input;
    let assembled = await this.contextAssembler.assemble({ channelId, profile });
    state.messages.push(...assembled.request.messages);
    this.noteShortfall(input, state, assembled);
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
        state.usage = addCompletionUsage(state.usage, completion.value.usage);
      }
      if (this.takesFurtherFragments(state, folds)) {
        folds += 1;
        assembled = await this.contextAssembler.assemble({ channelId, profile });
        state.messages.splice(0, state.messages.length, ...assembled.request.messages);
        this.noteShortfall(input, state, assembled);
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
      replay: replay ?? `[earlier ${identified.call.name} result superseded by a later one]`
    });
    while (state.supersedable.length > RETAINED_SUPERSEDABLE_RESULTS) {
      const stale = state.supersedable.shift()!;
      const message = state.messages[stale.messageIndex]!;
      state.messages[stale.messageIndex] = { ...message, content: stale.replay };
    }
  }

  /** §5.1 — the calls that may run together: a run of concurrent calls, or the next call alone */
  private takeBatch(input: RunInput, calls: readonly IdentifiedCall[], start: number): IdentifiedCall[] {
    const runsConcurrently = (identified: IdentifiedCall) => {
      return this.toolRegistry.isConcurrent(input.profile, identified.call.name);
    };
    let end = start + 1;
    if (runsConcurrently(calls[start]!)) {
      while (end < calls.length && runsConcurrently(calls[end]!)) {
        end += 1;
      }
    }
    return calls.slice(start, end);
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
}
