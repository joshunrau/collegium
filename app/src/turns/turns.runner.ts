import { describeReplaySubject, REPLAY_VERBATIM_MAX_CHARS } from '@collegium/core/tools';
import type { ToolPost, ToolReadOn, ToolTurnScope } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { match } from 'ts-pattern';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { ApprovalsService } from '@/approvals/approvals.service.ts';
import type { ApprovalDecision } from '@/approvals/approvals.types.ts';
import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import type { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConfigService } from '@/config/config.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import type { TurnRequestOrigin } from '@/conversations/conversations.types.ts';
import type { SpokenPostKind } from '@/conversations/conversations.utils.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import { MomentFormatter } from '@/formatting/dates/moment.formatter.ts';
import type { InferenceClient } from '@/inference/inference.client.ts';
import { InferenceRegistry } from '@/inference/inference.registry.ts';
import type {
  CompletionMessage,
  CompletionReasoning,
  CompletionRequest,
  CompletionResult,
  CompletionUsage,
  EstimatedCompletionUsage,
  InferenceFailure,
  StreamedChars,
  ToolCall,
  UnparsedToolCall
} from '@/inference/inference.types.ts';
import {
  addCompletionUsage,
  describeInferenceFailure,
  estimateMessageTokens,
  estimateRequestTokens,
  estimateStreamedUsage,
  isUnparsedToolCall,
  reasoningOf,
  toReplayableToolCall
} from '@/inference/inference.utils.ts';
import { createDeadlineAbort } from '@/inference/resilience/idle-abort.utils.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MemorySightingsRegistry } from '@/memory/sightings/memory-sightings.registry.ts';
import type { ActivationKind, ResultPresentation, TurnStatus } from '@/prisma/prisma.types.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { ToolExecutor } from '@/tools/tools.executor.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';
import { renderDenialTraceMark } from '@/tools/tools.renderer.ts';
import type { ToolAttempt, TraceMark } from '@/tools/tools.types.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';
import { extractMentionedUsernames } from '@/utils/mention.utils.ts';
import { renderReference } from '@/utils/reference.utils.ts';
import { WebService } from '@/web/web.service.ts';

import { renderApprovalContext } from './approval-context/approval-context.renderer.ts';
import { ActionBudget } from './budget/action.budget.ts';
import { renderExtensionDenialResult } from './budget/budget.renderer.ts';
import { ContextAssembler } from './context/context.assembler.ts';
import { renderAuthoredMessage } from './context/context.utils.ts';
import { TurnControlRegistry } from './control/turn-control.registry.ts';
import { TurnFoldRegistry } from './folding/turn-fold.registry.ts';
import {
  containsToolCallTranscript,
  lacksProse,
  renderOverranRejection,
  renderUnreportedUnitRejection
} from './guard/reply-guard.utils.ts';
import { renderTurnClosedLog, renderTurnOpenedLog } from './logging/turn-log.utils.ts';
import {
  hashResult,
  planRelief,
  planView,
  renderCollapsedLine,
  renderRepeatLine,
  renderRepeatNote,
  renderUnreadStandIn,
  renderViewLine,
  viewCapCharsFor,
  viewFloorChars
} from './retention/retention.utils.ts';
import {
  renderBudgetExhaustedNotice,
  renderChainLengthLimitNotice,
  renderContextExhaustedNotice,
  renderDelegationLimitNotice,
  renderDeliveryFailureNotice,
  renderDenialNotice,
  renderDrainLine,
  renderExtensionPrompt,
  renderFoldLine,
  renderOutputRefusedNotice,
  renderOverranLine,
  renderOverranNotice,
  renderProviderOutageNotice,
  renderProviderRejectionNotice,
  renderSemanticErrorNotice,
  renderSideEffectAmbiguityNotice,
  renderSteeringLine,
  renderToolCallLine,
  toOutcomeTraceMark,
  withViewMark
} from './status/status-post.renderer.ts';
import { StatusPostService } from './status/status-post.service.ts';
import { TurnsService } from './turns.service.ts';
import { TypingIndicatorService } from './typing/typing-indicator.service.ts';

import type { ApprovalContext, ApprovalRequester } from './approval-context/approval-context.renderer.ts';
import type { AssembledContext } from './context/context.assembler.ts';
import type { TurnControlHandle } from './control/turn-control.registry.ts';
import type { TurnFoldHandle } from './folding/turn-fold.registry.ts';
import type { StatusPostHandle, TraceLineHandle } from './status/status-post.service.ts';
import type {
  ContextExhaustionCause,
  HeldActivation,
  Steering,
  Turn,
  TurnEventInput,
  TurnOpenFailure,
  TurnOutcome
} from './turns.types.ts';

/** §3.8 — a recorded result still shown whole or as a view, longer than its line: what relief may replace, and with what */
type ShownResult = {
  readonly messageIndex: number;
  readonly readOn: ToolReadOn | undefined;
  readonly recordedAt: string;
  readonly ref: string;
  /** how much of the result the model is shown now; the rest is read on by reference */
  shownChars: number;
  readonly subject: string;
  readonly totalChars: number;
};

/** §3.8 — the result a later identical one repeats: where it sits, its reference, and the hash of its whole text */
type SeenResult = {
  readonly messageIndex: number;
  readonly outputHash: string;
  readonly ref: string;
  readonly subject: string;
};

/** §5.1, §3.8 — what a call that would park a person reads while the turn's context is over its ceiling */
const OVER_CEILING_RESULT =
  'this call was not run: this turn’s context is over its ceiling, and a call that waits on a person is not started then';

/** §4.5 — a tool call written as prose, whether a transcript the model copied or its provider's own markup */
const TOOL_CALL_AS_TEXT_REJECTION = 'post rejected: a tool call written as text runs nothing — invoke the tool instead';

/**
 * What a completion that never reached the post-time checks hears: cut at the output limit (§7.1),
 * or a call the provider left in the text. The loop either re-enters is the rejected post's (§4.5).
 */
const UNPOSTABLE_COMPLETION_REJECTIONS: {
  readonly [K in Exclude<CompletionResult['kind'], 'text' | 'tool-use'>]: string;
} = {
  'leaked-call': TOOL_CALL_AS_TEXT_REJECTION,
  truncated:
    'output rejected: it was cut off at the output limit before it finished — answer more briefly, or do the work in smaller steps'
};

/** §7.1 — a completion cut at the output limit before it wrote anything, for which "more briefly" would be false */
const EMPTY_TRUNCATION_REJECTION =
  'output rejected: it reached the output limit before any response or call was finished, and none of it was kept — reach your next call or your reply with less deliberation';

/** §4.5 — rejections in a row a turn survives; the budget bounds the loop too, but with a number that says nothing about why */
const CONSECUTIVE_REJECTION_LIMIT = 2;

/** §7.1 — the overrun that ends a turn, counted over the whole turn, so however the overruns fall a lane waits at most twice the limit */
const OVERRUN_LIMIT = 2;

/** §5.3 — how many repeated calls the extension prompt names; the loop it exposes is three URLs long, not fifty */
const TOP_REPEATED_CALLS = 5;

/** §7.2 — how many calls with unparseable arguments a turn survives; the second is a pattern, not a mistake */
const UNPARSED_CALL_LIMIT = 1;

/** §7.2 — how much of the provider's broken argument text the trace keeps; the model never sees any of it */
const RAW_ARGUMENTS_PREVIEW_CHARS = 200;

/** §7.2 — what the model reads instead of a diagnosis: no parameter, no type, no accepted set */
const UNPARSED_ARGUMENTS_RESULT = 'the arguments to this call were not valid JSON, so the call did not run';

/** §8.1 — the lines of calls the runner answered itself, which must not read as calls that ran */
const NOT_RUN_MARKS = {
  budgetSpent: { ran: false, text: '⚠️ not run: the action budget is spent' },
  overCeiling: { ran: false, text: '⚠️ not run: over the context ceiling' },
  unknownTool: { ran: false, text: '⚠️ not a tool it holds' },
  unparsedArguments: { ran: false, text: '⚠️ arguments not valid JSON' }
} as const satisfies { readonly [key: string]: TraceMark };

/** the bounds config states for every turn: §7.4 depth and chain length, §4.4 folds; the §5.3 budget is the agent's own */
type TurnLimits = {
  readonly chainLengthLimit: number;
  readonly delegationDepthLimit: number;
  readonly foldLimit: number;
};

type RunInput = {
  /** §8.3 — what started the turn, recorded on its row */
  activationKind: ActivationKind;
  chainLength: number;
  channelId: string;
  depth: number;
  /** set on a draining turn: the earliest unprocessed post the 👀 promised to read (§5.2) */
  drainedFromPostId?: string;
  /** §4.4 — the human whose further fragments this turn absorbs; absent on every other turn */
  foldAuthorUsername?: string;
  profile: AgentProfile;
  /** §5.2 — handed the colleague this turn's posts addressed once the turn ends or parks; must not wait on that colleague's turn */
  releaseHeldActivation: (held: HeldActivation) => void;
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

/** a call the executor may run, with the subject and effect its tool renders for the status post */
type RunnableCall = CallIdentity & {
  readonly call: ToolCall;
  readonly detail: string | undefined;
  readonly effect: string | undefined;
  readonly kind: 'runnable';
};

/** a call whose arguments never parsed: answered or refused by the runner, never executed (§7.2) */
type UnparsedCall = CallIdentity & { readonly call: UnparsedToolCall; readonly kind: 'unparsed' };

type IdentifiedCall = RunnableCall | UnparsedCall;

/** what answering an unparsed call came to: forgiven and answered in place, or the dispatch loop returns with this outcome */
type UnparsedCallDisposition = { kind: 'dispatched'; outcome: TurnOutcome | undefined } | { kind: 'forgiven' };

/**
 * A completion the runner cut short: at the agent's time limit (§7.1), or by a steer (§7.5), which
 * would discard it anyway. The stream reported no usage, so it carries an estimate of what it spent.
 */
type CutCompletion = { readonly cutBy: 'deadline' | 'steer'; readonly usage: EstimatedCompletionUsage };

/** §7.1 — a completion cut at its time limit, as the no-tool-call branch takes it: nothing of it is kept */
type OverranCompletion = { readonly content: ''; readonly kind: 'overran'; readonly usage: EstimatedCompletionUsage };

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
  /** §3.8 — how many messages the assembled context holds, so what the turn added is told from what it started with */
  assembledMessages: number;
  readonly budget: ActionBudget;
  /** §5.3 — how often each status-post line was admitted, so the extension prompt can name what the turn keeps repeating */
  readonly callTally: Map<string, number>;
  /** §4.5 — rejected posts and unknown tool names (§7.2) since the last call that ran */
  consecutiveRejections: number;
  /** §5.2 — when the context was last assembled, and the posts its window held */
  contextAssembledAt: Date;
  readonly control: TurnControlHandle;
  readonly fold: TurnFoldHandle;
  /** §5.2 — the colleague this turn has addressed since it last stopped acting, not yet started */
  heldActivation: HeldActivation | undefined;
  /** §5.3 — the agent's most recent interim text, quoted on the extension prompt as its own last words */
  lastInterimText: string | undefined;
  readonly messages: CompletionMessage[];
  /** §3.8 — the whole text of each result the latest completion's calls returned, while its view may still be refitted */
  readonly newestOutputs: Map<number, string>;
  /** §7.1 — completions this turn cut at the time limit, never reset: the second ends the turn */
  overruns: number;
  /** §7.1 — what each message the turn added is, by its place, for the exhaustion notice's largest parts */
  readonly partLabels: Map<number, string>;
  /** §3.8 — the estimated size of the whole outgoing request, kept current by `pushMessage` and `replaceMessage` */
  promptTokens: number;
  /** §3.8 — the provider whose wire form every message is measured in */
  readonly provider: AgentProfile['model']['provider'];
  /** §3.7 — the last reasoned denial of each tool, by display name, named on that tool's next approval prompt */
  readonly reasonedDenials: Map<string, { byUsername: string; reason: string }>;
  /** §7.1 — results this turn recorded; a turn that recorded none accumulated nothing a fresh one would not rebuild */
  recordedResults: number;
  /** §3.8 — the results replaced by their line or shown only by reference, whose repeat is shown again rather than answered by a line */
  readonly replacedResults: Set<number>;
  /** §3.7 — resolved at turn setup and again at every fold (§4.4), and quoted on every approval prompt the turn raises */
  requestedBy: ApprovalRequester | undefined;
  /** §3.8 — each recorded result's event, by the index of the message carrying it, where relief later says how the model read it (§8.3) */
  readonly resultEventIds: Map<number, string>;
  /** §3.8 — every result a later one could repeat, by what makes it identical, and where its copy was last shown */
  readonly seenResults: Map<string, SeenResult>;
  /** §3.8 — the results still shown whole or as a view, which relief may replace with their lines */
  readonly shownResults: ShownResult[];
  /** §7.1 — the estimated size of the context as assembled, the first of the exhaustion notice's largest parts */
  startTokens: number;
  readonly status: StatusPostHandle;
  /** §8.1 — each admitted call's status-post line, by call id, marked once the call's disposition is known */
  readonly traceHandles: Map<string, TraceLineHandle>;
  readonly transport: ChatTransport;
  readonly turn: Turn;
  /** §7.2 — calls with unparseable arguments this turn has already forgiven */
  unparsedCalls: number;
  /** §3.8 — the first message the model has not read yet: a result at or past it is never collapsed or cut short */
  unreadFrom: number;
  /** §3.15 — whether a reply was already sent back for leaving the unit the turn works unreported, which happens once */
  unreportedUnitRejected: boolean;
  usage: CompletionUsage | undefined;
  windowPostIds: ReadonlySet<string>;
  /** §3.14 — the unit this turn serves as its assignee, resolved once at setup so a report mid-turn does not unname it */
  readonly workUnit: ToolTurnScope['workUnit'];
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
    private readonly agentRegistry: AgentRegistry,
    private readonly approvalsService: ApprovalsService,
    configService: ConfigService,
    private readonly contextAssembler: ContextAssembler,
    private readonly conversationsService: ConversationsService,
    private readonly dateFormatter: DateFormatter,
    private readonly inferenceRegistry: InferenceRegistry,
    private readonly loggingService: LoggingService,
    private readonly memorySightingsRegistry: MemorySightingsRegistry,
    private readonly momentFormatter: MomentFormatter,
    private readonly multiMentionPolicy: MultiMentionPolicy,
    private readonly statusPostService: StatusPostService,
    private readonly tasksService: TasksService,
    private readonly toolExecutor: ToolExecutor,
    private readonly toolRegistry: ToolRegistry,
    private readonly transportRegistry: TransportRegistry,
    private readonly triggersService: TriggersService,
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

  /** §5.3 — the calls the turn keeps repeating, most first, for the person deciding whether to extend it */
  private static topCallsOf(state: TurnState): { count: number; line: string }[] {
    return Array.from(state.callTally, ([line, count]) => ({ count, line: line.replace(/^→ /u, '') }))
      .filter(({ count }) => count > 1)
      .sort((first, second) => second.count - first.count)
      .slice(0, TOP_REPEATED_CALLS);
  }

  /** §7.4 — a turn the chain limit refuses at admission opens nothing: no row, no status post, no session */
  async run(input: RunInput): Promise<Result<TurnOutcome, TurnOpenFailure>> {
    const { channelId, profile } = input;
    const opened = await this.turnsService.open({
      activationKind: input.activationKind,
      agentUsername: profile.username,
      chainLength: input.chainLength,
      channelId,
      depth: input.depth,
      drainedFromPostId: input.drainedFromPostId,
      modelName: profile.model.name,
      rootPostId: input.rootPostId,
      triggeringPostId: input.triggeringPostId
    });
    if (!opened.success) {
      return opened;
    }
    const turn = opened.value;
    this.loggingService.log(
      renderTurnOpenedLog({
        activationKind: input.activationKind,
        agentUsername: profile.username,
        chainLength: input.chainLength,
        channelId,
        depth: input.depth,
        drainedFromPostId: input.drainedFromPostId,
        triggeringPostId: input.triggeringPostId,
        turnId: turn.id
      })
    );
    const status = this.statusPostService.open({ agentUsername: profile.username, channelId, turnId: turn.id });
    const workUnit = await this.resolveServedUnit(input);
    const state: TurnState = {
      addressedPeer: undefined,
      assembledMessages: 0,
      budget: new ActionBudget(profile.actionBudget),
      callTally: new Map(),
      consecutiveRejections: 0,
      contextAssembledAt: new Date(),
      control: this.turnControlRegistry.register({
        agentUsername: profile.username,
        channelId,
        onSurface: () => status.surface(),
        turnId: turn.id
      }),
      fold: this.turnFoldRegistry.register({
        agentUsername: profile.username,
        authorUsername: input.foldAuthorUsername,
        channelId
      }),
      heldActivation: undefined,
      lastInterimText: undefined,
      messages: [],
      newestOutputs: new Map(),
      overruns: 0,
      partLabels: new Map(),
      promptTokens: 0,
      provider: profile.model.provider,
      reasonedDenials: new Map(),
      recordedResults: 0,
      replacedResults: new Set(),
      requestedBy: await this.resolveRequester(input.triggeringPostId, workUnit),
      resultEventIds: new Map(),
      seenResults: new Map(),
      shownResults: [],
      startTokens: 0,
      status,
      traceHandles: new Map(),
      transport: this.transportRegistry.get(profile.username),
      turn,
      unparsedCalls: 0,
      unreadFrom: 0,
      unreportedUnitRejected: false,
      usage: undefined,
      windowPostIds: new Set(),
      workUnit
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
      this.memorySightingsRegistry.forgetTurn(turn.id);
      this.tasksService.forgetPostsReadBy(turn.id);
      state.control.release();
      state.fold.release();
      this.releaseHeldActivation(input, state);
    }
  }

  /**
   * §7.5 — each steer spends an attempt, is kept on the trace, and reaches the model as the human
   * speaking, prefixed exactly as a post is. It is new information, so the count of rejected posts
   * starts again (§4.5). Where the steer aborted a completion in flight, the first steer's event
   * carries the estimate of what it had streamed. Returns the outcome where the budget ends the turn instead.
   */
  private async absorbSteering(
    input: RunInput,
    state: TurnState,
    taken: readonly Steering[],
    estimate?: EstimatedCompletionUsage
  ): Promise<TurnOutcome | undefined> {
    let usage = estimate;
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
      await this.turnsService.appendEvent(state.turn.id, {
        kind: 'steering_received',
        ...steering,
        ...(usage !== undefined && { usage })
      });
      usage = undefined;
      this.pushMessage(state, {
        content: renderAuthoredMessage(steering.byUsername, 'human', steering.text),
        role: 'user'
      });
      state.status.appendTrace({ kind: 'note', text: renderSteeringLine(steering.byUsername) });
      state.consecutiveRejections = 0;
      if (denial !== undefined) {
        // the remaining steers are words the human said; they are heard, but no further attempt is spent
        for (const rest of taken.slice(index + 1)) {
          await this.turnsService.appendEvent(state.turn.id, { kind: 'steering_received', ...rest });
          this.pushMessage(state, {
            content: renderAuthoredMessage(rest.byUsername, 'human', rest.text),
            role: 'user'
          });
          state.status.appendTrace({ kind: 'note', text: renderSteeringLine(rest.byUsername) });
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
      return { kind: 'ended', outcome: await this.close(state, aborted.kind) };
    }
    const isExempt = this.toolRegistry.isBudgetExempt(input.profile, identified.call.name);
    if (state.budget.trySpend(isExempt) === 'exhausted') {
      const exhaustion = await this.handleExhaustion(input, state);
      if (exhaustion.kind !== 'extended') {
        return exhaustion;
      }
      state.budget.trySpend(isExempt);
    }
    const traced =
      identified.kind === 'runnable'
        ? { detail: identified.detail, effect: identified.effect }
        : { detail: undefined, effect: undefined };
    state.traceHandles.set(
      identified.call.id,
      state.status.appendTrace({ ...traced, kind: 'call', toolName: identified.displayName })
    );
    const line = renderToolCallLine(identified.displayName, traced.detail, traced.effect);
    state.callTally.set(line, (state.callTally.get(line) ?? 0) + 1);
    return {
      kind: 'admitted',
      position: { actionBudget: state.budget.limitCount, actionNumber: state.budget.spentCount }
    };
  }

  /** §5.1, §3.8 — a call that would park a person is not started while the context is over its ceiling: its line and its event say it did not run */
  private async answerOverCeiling(state: TurnState, identified: RunnableCall): Promise<void> {
    state.traceHandles.set(
      identified.call.id,
      state.status.appendTrace({
        detail: identified.detail,
        effect: undefined,
        kind: 'call',
        toolName: identified.displayName
      })
    );
    this.markTraceLine(state, identified, NOT_RUN_MARKS.overCeiling);
    await this.turnsService.appendEvent(state.turn.id, {
      callId: identified.call.id,
      kind: 'tool_result',
      output: OVER_CEILING_RESULT,
      toolName: identified.recordedName,
      traceMark: NOT_RUN_MARKS.overCeiling
    });
    this.pushMessage(state, { content: OVER_CEILING_RESULT, role: 'tool', toolCallId: identified.call.id });
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
    this.markTraceLine(state, identified, NOT_RUN_MARKS.unknownTool);
    await this.turnsService.appendEvent(state.turn.id, {
      callId: identified.call.id,
      kind: 'tool_result',
      output,
      toolName: identified.recordedName,
      traceMark: NOT_RUN_MARKS.unknownTool
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
      this.markTraceLine(state, identified, NOT_RUN_MARKS.budgetSpent);
      await this.turnsService.appendEvent(state.turn.id, {
        callId: identified.call.id,
        kind: 'tool_result',
        output: text,
        toolName: identified.recordedName,
        traceMark: NOT_RUN_MARKS.budgetSpent
      });
      this.pushMessage(state, { content: text, role: 'tool', toolCallId: identified.call.id });
    }
  }

  /**
   * The appender handed to tool execution and the approval flow. A prompt's requested event is
   * written as the prompt lands and before the turn waits on it, so it is the moment the turn
   * parks on a person (§3.7, §3.7a): a parked turn releases its colleague rather than hold it for
   * as long as that person takes (§5.2), and its status post says what it waits on (§8.1) until
   * the decision's own event is written. A cancelled decision writes none; it ends the turn, whose
   * outcome replaces the head.
   */
  private async appendEventTrackingParks(input: RunInput, state: TurnState, event: TurnEventInput): Promise<void> {
    await this.turnsService.appendEvent(state.turn.id, event);
    switch (event.kind) {
      case 'approval_decided':
        state.status.unpark(event.approvalId);
        return;
      case 'approval_requested':
        state.status.park(event.approvalId, 'approval');
        this.releaseHeldActivation(input, state);
        return;
      case 'ask_answered':
        state.status.unpark(event.askId);
        return;
      case 'ask_requested':
        state.status.park(event.askId, 'ask');
        this.releaseHeldActivation(input, state);
        return;
      default:
        return;
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

  /** §3.7 — what the approver is told above the payload, including the denial an amended call answers */
  private assembleApprovalContext(
    state: TurnState,
    identified: IdentifiedCall,
    position: BudgetPosition
  ): ApprovalContext {
    const denial = state.reasonedDenials.get(identified.displayName);
    return {
      ...position,
      ...(denial && {
        follows: {
          byUsername: denial.byUsername,
          reason: this.multiMentionPolicy.stripAgentMentions(denial.reason),
          toolName: identified.displayName
        }
      }),
      requestedBy: state.requestedBy
    };
  }

  /**
   * Every exit but a §7.1 failure, which closes through `closeWithFailureNotice`, and a denial,
   * which closes through `closeOnDenial`; a command's exit names its invoker (§7.5).
   */
  private close(
    state: TurnState,
    status: Exclude<TurnStatus, 'denied' | 'running' | FailureStatus>
  ): Promise<TurnOutcome> {
    const aborted = state.control.aborted();
    return this.writeClosingStatus(state, status, aborted?.kind === status ? aborted.byUsername : undefined);
  }

  /**
   * §7.1 — out of room: the notice states the context's size against the ceiling and its largest
   * parts, and a unit the turn worked is reported blocked (§3.15)
   */
  private async closeOnContextExhausted(
    input: RunInput,
    state: TurnState,
    cause: ContextExhaustionCause
  ): Promise<TurnOutcome> {
    await this.postNotice(
      input,
      state,
      renderContextExhaustedNotice({
        cause,
        ceilingTokens: input.profile.turnContextCeilingTokens,
        largest: this.largestPartsOf(state),
        promptTokens: state.promptTokens
      })
    );
    await this.reportExhaustedUnit(input, state, cause);
    return this.writeClosingStatus(state, 'context_exhausted');
  }

  /**
   * §5.4 — a bare denial ends the turn, and its line, its outcome and its notice name who denied it
   * (§8.1). The unit the turn was working stays assigned: the notice names it, and nothing reports
   * it to its creator (§3.15).
   */
  private async closeOnDenial(
    input: RunInput,
    state: TurnState,
    identified: IdentifiedCall,
    byUsername: string
  ): Promise<TurnOutcome> {
    this.markTraceLine(state, identified, renderDenialTraceMark(byUsername));
    const unit = await this.tasksService.findWorkedUnit({
      agentUsername: input.profile.username,
      channelId: input.channelId,
      triggeringPostId: input.triggeringPostId
    });
    await this.postNotice(
      input,
      state,
      renderDenialNotice({
        byUsername,
        toolName: identified.displayName,
        unit: unit && {
          creatorDisplayName: this.agentRegistry.displayNameOf(unit.creatorUsername),
          reference: renderReference(unit.id)
        }
      })
    );
    return this.writeClosingStatus(state, 'denied', byUsername);
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
      return this.closeOnContextExhausted(input, state, state.recordedResults === 0 ? 'initial' : 'accumulated');
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
    if (attempt.status === 'denied') {
      return this.closeOnDenial(input, state, identified, attempt.byUsername);
    }
    const mark = match<typeof attempt.status, TraceMark>(attempt.status)
      .with('delivery_failure', () => ({ ran: false, text: '⚠️ undelivered' }))
      // §8.1 — a call the command or halt cancelled did not run, and must not read as one that did
      .with('halted', 'killed', 'stopped', () => ({ ran: false, text: '⏹️ cancelled' }))
      .with('semantic_error', () => ({ ran: true, text: '⚠️ error' }))
      .with('side_effect_ambiguous', () => ({ ran: true, text: '⚠️ unconfirmed' }))
      .exhaustive();
    this.markTraceLine(state, identified, mark);
    if (attempt.status === 'semantic_error' || attempt.status === 'side_effect_ambiguous') {
      await this.turnsService.appendEvent(state.turn.id, {
        callId: identified.call.id,
        kind: 'tool_result',
        output: attempt.detail,
        toolName: identified.recordedName,
        traceMark: mark
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
        // §7.5 — a cancellation posts no follow-up; the command or halt already spoke
        .with('halted', 'killed', 'stopped', (status) => this.close(state, status))
        .exhaustive()
    );
  }

  /** §7.1 — the notice goes out as one post, then the turn closes */
  private async closeWithFailureNotice(
    input: RunInput,
    state: TurnState,
    status: Exclude<FailureStatus, 'context_exhausted'>,
    notice: string
  ): Promise<TurnOutcome> {
    await this.postNotice(input, state, notice);
    return this.writeClosingStatus(state, status);
  }

  /**
   * The final completion is recorded as an event whether or not it posts: with its reasoning, it is
   * what the window replays, and the post is only the channel's copy. A reply that could not be
   * posted is not a completion — §7.1 defines normal completion as visible as the final post — so
   * the turn closes as a delivery failure, a non-progress exit. A colleague's request answered to
   * no one is said, never re-routed (§7.6).
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

  /** §3.8 — a read result replaced by its line for the rest of the turn; its event keeps the text and says so (§8.3) */
  private async collapseResult(state: TurnState, messageIndex: number): Promise<void> {
    const at = state.shownResults.findIndex((shown) => shown.messageIndex === messageIndex);
    const [shown] = state.shownResults.splice(at, 1);
    state.replacedResults.add(messageIndex);
    this.replaceMessage(state, messageIndex, renderCollapsedLine(shown!));
    await this.recordPresentation(state, messageIndex, { collapsed: true });
  }

  /**
   * §8.1 — the typing indicator is lit for exactly as long as the model is generating. Tool
   * execution and approval waits stay dark: the status post and the approval prompt speak there,
   * and an indicator held through a human's deliberation would be claiming work that is not
   * happening. The finally covers every exit, including the kill race and a thrown request.
   *
   * §7.1, §7.5 — the request runs under the agent's time limit and is aborted by a steer, and a
   * failure either caused comes back as the cut it was, with an estimate of what it had streamed. A
   * completion that settled in the tick its deadline fired is kept.
   */
  private async complete(
    input: RunInput,
    state: TurnState,
    client: InferenceClient,
    request: CompletionRequest
  ): Promise<'killed' | CutCompletion | Result<CompletionResult, InferenceFailure>> {
    const typing = this.typingIndicatorService.start({
      agentUsername: input.profile.username,
      channelId: input.channelId
    });
    const deadline = createDeadlineAbort(input.profile.completionTimeLimitMs);
    const steer = state.control.abortOnSteer();
    let streamed: StreamedChars = { completionChars: 0, reasoningChars: 0 };
    try {
      const settled = await Promise.race([
        client.complete(
          { ...request, messages: state.messages },
          {
            onStreamed: (sofar) => {
              streamed = sofar;
            },
            signal: AbortSignal.any([state.control.killSignal, deadline.signal, steer])
          }
        ),
        state.control.killed
      ]);
      if (settled === 'killed' || settled.success) {
        return settled;
      }
      if (deadline.signal.aborted) {
        return { cutBy: 'deadline', usage: estimateStreamedUsage(streamed) };
      }
      return steer.aborted ? { cutBy: 'steer', usage: estimateStreamedUsage(streamed) } : settled;
    } finally {
      deadline.clear();
      typing.stop();
    }
  }

  /**
   * The branch with no tool call: the turn's final output when it may post, else fed back as a
   * user message for another try under the budget — this branch carries no tool call for a tool
   * result to reference (§4.5). Output cut at the provider's limit (§7.1) and a call the provider
   * left in the text take the same loop. The trace keeps every rejected output and why (§8.3).
   */
  private async concludeOrRetry(
    input: RunInput,
    state: TurnState,
    completion: Exclude<CompletionResult, CompletionResult.ToolUse> | OverranCompletion
  ): Promise<TurnOutcome | undefined> {
    const content =
      completion.kind === 'text' ? await this.enforceChainLimits(input, state, completion.content) : completion.content;
    let rejection =
      completion.kind === 'text'
        ? ((await this.rejectionOf(input, state, content)) ??
          (await this.rejectionOfUnreportedUnit(input, state, completion.content)))
        : this.rejectionOfUnpostable(input, completion);
    const reasoning = completion.kind === 'overran' ? {} : reasoningOf(completion);
    if (rejection === undefined) {
      return this.closeWithFinalOutput(input, state, content, reasoning);
    }
    await this.turnsService.appendEvent(state.turn.id, {
      content,
      kind: 'output_rejected',
      reason: rejection,
      ...(completion.kind === 'overran' && { usage: completion.usage })
    });
    const limitMs = input.profile.completionTimeLimitMs;
    if (completion.kind === 'overran') {
      state.overruns += 1;
      state.status.appendTrace({ kind: 'note', text: renderOverranLine(limitMs) });
    }
    // checked before the spend: the rejection that ends the turn buys nothing, so it costs nothing
    if (state.overruns >= OVERRUN_LIMIT || state.consecutiveRejections >= CONSECUTIVE_REJECTION_LIMIT) {
      const notice =
        completion.kind === 'overran' ? renderOverranNotice(limitMs, state.overruns) : renderOutputRefusedNotice();
      return this.closeWithFailureNotice(input, state, 'semantic_error', notice);
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
      isGranted: (ref) => this.toolRegistry.isGranted(input.profile, ref),
      triggeringPostId: input.triggeringPostId ?? null,
      turnId: state.turn.id,
      workUnit: state.workUnit
    };
  }

  /** §7.1 — a call as its status-post line names it, in a code span so a notice quoting it addresses no one */
  private describeCall(identified: IdentifiedCall): string {
    const detail = identified.kind === 'runnable' ? identified.detail : undefined;
    return renderToolCallLine(identified.displayName, detail).replace(/^→ /u, '');
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
      ...(disclosure.revision !== undefined && { revision: disclosure.revision }),
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
    state.partLabels.set(
      state.messages.length - 1,
      `${calls.map((call) => this.describeCall(call)).join(', ')} (my call)`
    );
    state.unreadFrom = state.messages.length;
    state.newestOutputs.clear();
    // §3.7a — this completion's own text, which an earlier completion's must not stand in for
    const interimText =
      completion.content === '' ? undefined : this.multiMentionPolicy.stripAgentMentions(completion.content);
    if (interimText !== undefined) {
      state.lastInterimText = interimText;
      state.status.setTransient(interimText);
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
      if (
        this.toolRegistry.parksOnPerson(input.profile, first.call.name) &&
        (await this.fitContext(input, state)) === 'exhausted'
      ) {
        await this.answerOverCeiling(state, first);
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
              appendEvent: (event) => this.appendEventTrackingParks(input, state, event),
              call: identified.call,
              contextText: renderApprovalContext(this.assembleApprovalContext(state, identified, positions[index]!)),
              ...(interimText !== undefined && { preface: interimText }),
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
    return state.promptTokens > input.profile.turnContextCeilingTokens;
  }

  /**
   * §3.8 — the ceiling, checked before each completion, before a call that would park a person, and
   * before an extension is asked for. Over it, read results give way to their lines, the largest first,
   * down to the low-water mark in one pass; still over, the views of the results just received shorten
   * together towards the floor, and one that cannot keep even that shows only its size and reference.
   * Only what is over after both is a turn out of room.
   */
  private async fitContext(input: RunInput, state: TurnState): Promise<'exhausted' | 'fits'> {
    const ceilingTokens = input.profile.turnContextCeilingTokens;
    if (state.promptTokens <= ceilingTokens) {
      return 'fits';
    }
    const candidates = state.shownResults
      .filter(({ messageIndex }) => messageIndex < state.unreadFrom)
      .map((shown) => {
        const message = state.messages[shown.messageIndex]!;
        const standIn = { ...message, content: renderCollapsedLine(shown) };
        return {
          key: shown.messageIndex,
          savedTokens: estimateMessageTokens(message, state.provider) - estimateMessageTokens(standIn, state.provider)
        };
      });
    for (const key of planRelief({ candidates, ceilingTokens, promptTokens: state.promptTokens })) {
      await this.collapseResult(state, key);
    }
    if (state.promptTokens > ceilingTokens) {
      await this.fitNewestResults(input, state);
    }
    return state.promptTokens <= ceilingTokens ? 'fits' : 'exhausted';
  }

  /** §3.8 — the views of the results the latest completion's calls returned, shortened together while the context is still over its ceiling */
  private async fitNewestResults(input: RunInput, state: TurnState): Promise<void> {
    const newest = state.shownResults.filter(({ messageIndex }) => state.newestOutputs.has(messageIndex));
    const plan = planView({
      candidates: newest.map(({ messageIndex, shownChars }) => ({ key: messageIndex, shownChars })),
      excessTokens: state.promptTokens - input.profile.turnContextCeilingTokens,
      floorChars: viewFloorChars()
    });
    for (const shown of newest) {
      const output = state.newestOutputs.get(shown.messageIndex)!;
      if (plan.standIns.includes(shown.messageIndex)) {
        state.shownResults.splice(state.shownResults.indexOf(shown), 1);
        state.replacedResults.add(shown.messageIndex);
        this.replaceMessage(state, shown.messageIndex, renderUnreadStandIn(shown));
        await this.recordPresentation(state, shown.messageIndex, { shownChars: 0 });
        continue;
      }
      const shownChars = plan.shownChars.get(shown.messageIndex);
      if (shownChars === undefined) {
        continue;
      }
      shown.shownChars = shownChars;
      this.replaceMessage(state, shown.messageIndex, `${output.slice(0, shownChars)}${renderViewLine(shown)}`);
      await this.recordPresentation(state, shown.messageIndex, { shownChars });
    }
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
    this.markTraceLine(state, identified, NOT_RUN_MARKS.unparsedArguments);
    await this.turnsService.appendEvent(state.turn.id, {
      callId: identified.call.id,
      kind: 'tool_result',
      output: UNPARSED_ARGUMENTS_RESULT,
      rawArgumentsPreview: identified.call.rawArguments.slice(0, RAW_ARGUMENTS_PREVIEW_CHARS),
      toolName: identified.recordedName,
      traceMark: NOT_RUN_MARKS.unparsedArguments
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
      return { kind: 'ended', outcome: await this.close(state, aborted.kind) };
    }
    // §5.3 — nobody is asked to extend a turn whose context is over its ceiling
    if ((await this.fitContext(input, state)) === 'exhausted') {
      return { kind: 'ended', outcome: await this.closeOnContextExhausted(input, state, 'accumulated') };
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
      appendEvent: (event) => this.appendEventTrackingParks(input, state, event),
      args: { attemptsSoFar: state.budget.spentCount, extensionNumber },
      channelId: input.channelId,
      payloadPresentation: 'collapse',
      payloadText: renderExtensionPrompt({
        attemptsSoFar: state.budget.spentCount,
        extensionNumber,
        grant: state.budget.baseCount,
        lastWords: state.lastInterimText,
        topCalls: TurnRunner.topCallsOf(state)
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
        .with({ kind: 'denied-with-reason' }, ({ byUsername, reason }) => {
          state.budget.refuseFurtherExtensions();
          return Promise.resolve<Exhaustion>({
            kind: 'voice-only',
            text: renderExtensionDenialResult(byUsername, reason)
          });
        })
        .exhaustive()
    );
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
    return { ...identity, call, detail: described?.detail, effect: described?.effect, kind: 'runnable' };
  }

  /** §3.8 — what makes a later result identical to this one: its text, or for a supersedable page its content; nothing for a result too short to be worth matching */
  private identityOf(
    input: RunInput,
    identified: IdentifiedCall,
    result: ToolAttempt.Continue
  ): undefined | { readonly key: string; readonly outputHash: string } {
    const outputHash = hashResult(result.output);
    if (this.toolRegistry.isSupersedable(input.profile, identified.call.name)) {
      return { key: `content ${hashResult(result.contentIdentity ?? result.output)}`, outputHash };
    }
    return result.output.length > REPLAY_VERBATIM_MAX_CHARS ? { key: `text ${outputHash}`, outputHash } : undefined;
  }

  /** §7.1 — the three largest things in the context: what the turn started with, and each part it added since, by what it is */
  private largestPartsOf(state: TurnState): { readonly label: string; readonly tokens: number }[] {
    const added = state.messages.slice(state.assembledMessages).map((message, offset) => {
      const label = state.partLabels.get(state.assembledMessages + offset) ?? 'a note to me in this turn';
      return { label, tokens: estimateMessageTokens(message, state.provider) };
    });
    return [{ label: 'the context this turn started with', tokens: state.startTokens }, ...added]
      .toSorted((left, right) => right.tokens - left.tokens)
      .slice(0, 3);
  }

  /**
   * §3.8 — the request as assembled is measured whole; everything pushed afterwards adds its own
   * estimate. The window's posts are what this turn has read, which a close rests on (§3.15), and
   * the window itself goes on the turn's row for the trace (§8.3).
   */
  private async loadAssembledContext(state: TurnState, assembled: AssembledContext): Promise<void> {
    state.messages.splice(0, state.messages.length, ...assembled.request.messages);
    state.promptTokens = estimateRequestTokens({ ...assembled.request, messages: state.messages });
    state.startTokens = state.promptTokens;
    state.assembledMessages = state.messages.length;
    state.contextAssembledAt = assembled.assembledAt;
    state.windowPostIds = assembled.windowPostIds;
    this.tasksService.recordPostsRead(state.turn.id, assembled.windowPostIds);
    await this.turnsService.recordAssembledWindow(state.turn.id, {
      assembledAt: assembled.assembledAt,
      estimatedTokens: assembled.windowEstimatedTokens,
      oldestAt: assembled.reachesBackTo
    });
  }

  /** §8.1 — the line was written at admission; the call's disposition is known only now */
  private markTraceLine(state: TurnState, identified: IdentifiedCall, mark: TraceMark | undefined): void {
    const handle = state.traceHandles.get(identified.call.id);
    if (handle !== undefined && mark !== undefined) {
      state.status.markTrace(handle, mark);
    }
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
   * (§4.5) and held until the turn stops acting (§5.2). The record is what makes a later return
   * recognisable (§7.4).
   */
  private async publish(
    input: RunInput,
    state: TurnState,
    text: string,
    kind: SpokenPostKind
  ): Promise<Result<{ postId: string }, { message: string }>> {
    const sent = await state.transport.send({ channelId: input.channelId, text });
    if (!sent.success) {
      return sent;
    }
    const addressee = this.multiMentionPolicy.findAddressee({
      authorUsername: input.profile.username,
      channelId: input.channelId,
      message: text
    });
    if (addressee !== undefined) {
      state.addressedPeer = addressee;
      state.heldActivation ??= { addresseeUsername: addressee, postId: sent.value.postId };
    }
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
    const refusal = await this.refusalOfFrameworkPost(input, state, text);
    if (refusal !== undefined) {
      return { kind: 'refused', output: refusal };
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
    state.promptTokens += estimateMessageTokens(message, state.provider);
  }

  /**
   * §3.8 — a result as the model reads it: whole where it fits its view, else the view's part with a
   * line naming its size, when it was recorded and how to read on. A repeat of a result still shown is
   * one line naming it, and a repeat of one since replaced is shown again, saying which it repeats.
   */
  private async pushResult(
    input: RunInput,
    state: TurnState,
    identified: IdentifiedCall,
    result: ToolAttempt.Continue,
    recorded: { readonly eventId: string; readonly ref: string; readonly shownChars: number }
  ): Promise<void> {
    const { output } = result;
    const { ref, shownChars } = recorded;
    const toolCallId = identified.call.id;
    const subject = result.replaySubject ?? describeReplaySubject(`${identified.displayName} result`, output);
    const identity = this.identityOf(input, identified, result);
    const earlier = identity === undefined ? undefined : state.seenResults.get(identity.key);
    const isSameText = earlier?.outputHash === identity?.outputHash;
    if (earlier !== undefined && !state.replacedResults.has(earlier.messageIndex)) {
      const line = renderRepeatLine({ earlierRef: earlier.ref, earlierSubject: earlier.subject, isSameText, ref });
      this.pushMessage(state, { content: line, role: 'tool', toolCallId });
      state.resultEventIds.set(state.messages.length - 1, recorded.eventId);
      await this.recordPresentation(state, state.messages.length - 1, { repeatOf: earlier.ref });
      return;
    }
    const now = new Date();
    const recordedAt = this.momentFormatter.format(now, now);
    const shown =
      shownChars < output.length
        ? `${output.slice(0, shownChars)}${renderViewLine({ readOn: result.readOn, recordedAt, ref, shownChars, totalChars: output.length })}`
        : output;
    const content =
      earlier === undefined ? shown : `${renderRepeatNote({ earlierRef: earlier.ref, isSameText })}\n\n${shown}`;
    this.pushMessage(state, { content, role: 'tool', toolCallId });
    const messageIndex = state.messages.length - 1;
    state.resultEventIds.set(messageIndex, recorded.eventId);
    state.newestOutputs.set(messageIndex, output);
    state.partLabels.set(messageIndex, `result ${ref}, ${this.describeCall(identified)}`);
    if (identity !== undefined) {
      state.seenResults.set(identity.key, { messageIndex, outputHash: identity.outputHash, ref, subject });
    }
    if (content.length > REPLAY_VERBATIM_MAX_CHARS) {
      state.shownResults.push({
        messageIndex,
        readOn: result.readOn,
        recordedAt,
        ref,
        shownChars,
        subject,
        totalChars: output.length
      });
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
    if (attempt.kind === 'unknown-tool') {
      return this.answerUnknownTool(input, state, identified, attempt.output);
    }
    state.consecutiveRejections = 0;
    if (attempt.reasonedDenial) {
      state.reasonedDenials.set(identified.displayName, attempt.reasonedDenial);
    }
    const published = attempt.post === undefined ? undefined : await this.publishToolPost(input, state, attempt.post);
    if (published?.kind === 'undelivered') {
      return published.outcome;
    }
    const result: ToolAttempt.Continue =
      published?.kind === 'refused' ? { kind: 'continue', output: published.output } : attempt;
    const mark =
      published?.kind === 'refused'
        ? { ran: true, text: '⚠️ post refused' }
        : (attempt.traceMark ?? toOutcomeTraceMark(attempt.traceOutcome));
    const viewChars = Math.min(result.viewChars ?? Number.POSITIVE_INFINITY, viewCapCharsFor(input.profile));
    const shownChars = Math.min(result.output.length, viewChars);
    const isView = shownChars < result.output.length;
    const event = await this.turnsService.appendEvent(state.turn.id, {
      callId: identified.call.id,
      kind: 'tool_result',
      output: result.output,
      presentedAs: { viewChars, ...(isView && { shownChars }) },
      toolName: identified.recordedName,
      ...(result.replay !== undefined && { replay: result.replay }),
      ...(result.replaySubject !== undefined && { replaySubject: result.replaySubject }),
      ...(mark !== undefined && { traceMark: mark })
    });
    await this.pushResult(input, state, identified, result, {
      eventId: event.id,
      ref: `r${event.sequence}`,
      shownChars
    });
    state.recordedResults += 1;
    const view = isView ? { shownChars, totalChars: result.output.length } : undefined;
    this.markTraceLine(state, identified, withViewMark(mark, view));
    if (published?.kind === 'published' && attempt.post) {
      await attempt.post.onPublished(published.postId);
    }
    if (result.disclosure) {
      await this.discloseRecord(state, result.disclosure);
    }
    return undefined;
  }

  /** §8.3 — how the model came to read a result, on the result's own event; a message carrying no recorded result has none */
  private async recordPresentation(
    state: TurnState,
    messageIndex: number,
    presentation: ResultPresentation
  ): Promise<void> {
    const eventId = state.resultEventIds.get(messageIndex);
    if (eventId !== undefined) {
      await this.turnsService.recordPresentation(eventId, presentation);
    }
  }

  /** why a post the framework publishes for the turn may not post (§4.5), or nothing */
  private async refusalOfFrameworkPost(input: RunInput, state: TurnState, text: string): Promise<string | undefined> {
    const addressable = this.asAddressablePost(input, text);
    if (this.multiMentionPolicy.refuses(addressable)) {
      return 'post refused: it addresses more than one colleague';
    }
    if (this.multiMentionPolicy.refusesSecondAddressee(addressable, state.addressedPeer)) {
      return `post refused: this turn has already addressed @${state.addressedPeer}`;
    }
    const oversize = await this.measureAgainstPostLimit(state, text);
    if (oversize) {
      return `post refused: it is ${oversize.length} characters and a post holds at most ${oversize.limit} — shorten what you pass`;
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
      return TOOL_CALL_AS_TEXT_REJECTION;
    }
    if (lacksProse(content)) {
      return 'post rejected: the reply has no prose in it — write the message you mean to send';
    }
    const oversize = await this.measureAgainstPostLimit(state, content);
    if (oversize) {
      return `post rejected: the reply is ${oversize.length} characters and a post holds at most ${oversize.limit} — answer more briefly, or post the first part and say what remains`;
    }
    return undefined;
  }

  /** §7.1, §7.2 — what a completion that never reached the post-time checks is told, saying which limit cut it and whether anything was kept */
  private rejectionOfUnpostable(
    input: RunInput,
    completion: CompletionResult.LeakedCall | CompletionResult.Truncated | OverranCompletion
  ): string {
    return match(completion)
      .with({ kind: 'overran' }, () => renderOverranRejection(input.profile.completionTimeLimitMs))
      .with({ content: '', kind: 'truncated' }, () => EMPTY_TRUNCATION_REJECTION)
      .with({ kind: 'truncated' }, { kind: 'leaked-call' }, ({ kind }) => UNPOSTABLE_COMPLETION_REJECTIONS[kind])
      .exhaustive();
  }

  /**
   * §3.15 — a final reply that reaches nobody, while the unit this turn works is still assigned to
   * it, ends the turn with nothing to start the creator's, so it goes back once. It is read as the
   * model wrote it, before a loop limit strips a mention (§7.4). Not where the turn has addressed a
   * colleague already, since that colleague's turn is the way on and a second addressee would be
   * refused (§4.5); and never as the rejection that ends the turn or asks a person for attempts,
   * since the reply it would cost is a valid one.
   */
  private async rejectionOfUnreportedUnit(
    input: RunInput,
    state: TurnState,
    written: string
  ): Promise<string | undefined> {
    if (
      state.unreportedUnitRejected ||
      state.addressedPeer !== undefined ||
      state.consecutiveRejections >= CONSECUTIVE_REJECTION_LIMIT ||
      state.budget.spentCount >= state.budget.limitCount ||
      this.multiMentionPolicy.addressesAnyone({
        authorUsername: input.profile.username,
        channelId: input.channelId,
        message: written
      })
    ) {
      return undefined;
    }
    const unit = await this.tasksService.findWorkedUnit({
      agentUsername: input.profile.username,
      channelId: input.channelId,
      triggeringPostId: input.triggeringPostId
    });
    if (!unit) {
      return undefined;
    }
    state.unreportedUnitRejected = true;
    return renderUnreportedUnitRejection({
      canReport: this.toolRegistry.isGranted(input.profile, 'tasks::report'),
      creatorDisplayName: this.agentRegistry.displayNameOf(unit.creatorUsername),
      creatorUsername: unit.creatorUsername,
      reference: renderReference(unit.id)
    });
  }

  /** §5.2 — takes the hold, so a colleague a park released is not released again when the turn ends */
  private releaseHeldActivation(input: RunInput, state: TurnState): void {
    const held = state.heldActivation;
    state.heldActivation = undefined;
    if (held !== undefined) {
      input.releaseHeldActivation(held);
    }
  }

  /** §3.8 — the one door for changing a message already pushed: the estimate moves with it */
  private replaceMessage(state: TurnState, messageIndex: number, content: string): void {
    const message = state.messages[messageIndex]!;
    const replaced = { ...message, content };
    state.messages[messageIndex] = replaced;
    state.promptTokens +=
      estimateMessageTokens(replaced, state.provider) - estimateMessageTokens(message, state.provider);
  }

  /**
   * §3.15 — the unit this turn was working goes to its creator as blocked, through the path a
   * report takes: refused as any post is, and written only once its post has landed. Best-effort
   * and never retried, since the turn is already closing (A4).
   */
  private async reportExhaustedUnit(input: RunInput, state: TurnState, cause: ContextExhaustionCause): Promise<void> {
    try {
      const report = await this.tasksService.prepareExhaustionReport({
        agentUsername: input.profile.username,
        cause,
        channelId: input.channelId,
        triggeringPostId: input.triggeringPostId
      });
      if (!report) {
        return;
      }
      const text = this.multiMentionPolicy.stripAgentMentionsExcept(report.text, report.addressee);
      const refusal = await this.refusalOfFrameworkPost(input, state, text);
      if (refusal !== undefined) {
        this.loggingService.warn(`did not report the unit of "${input.profile.username}" blocked: ${refusal}`);
        return;
      }
      const sent = await this.publish(input, state, text, 'notice');
      if (!sent.success) {
        this.loggingService.error(new Error(`failed to report a unit blocked: ${sent.error.message}`));
        return;
      }
      await this.tasksService.commitTransition(report.prepared, sent.value.postId);
    } catch (error) {
      this.loggingService.error(new Error('failed to report the exhausted turn’s unit blocked', { cause: error }));
    }
  }

  /**
   * §3.7 — who asked, read at turn setup and again at every fold, beside the unit the turn serves
   * where a colleague's assignment started it. Peer mentions lose their @ before the words can be
   * quoted back, since an approval prompt addresses no colleague (§4.5).
   */
  private async resolveRequester(
    postId: string | undefined,
    workUnit: ToolTurnScope['workUnit']
  ): Promise<ApprovalRequester | undefined> {
    if (postId === undefined) {
      return undefined;
    }
    const request = await this.conversationsService.findRequester(postId);
    return match(request)
      .with(undefined, () => undefined)
      .with({ kind: 'human' }, (human) => this.stripRequestOrigin(human))
      .with({ kind: 'agent' }, ({ onBehalfOf, username }): ApprovalRequester => {
        return {
          displayName: this.agentRegistry.displayNameOf(username),
          kind: 'agent',
          onBehalfOf: this.stripRequestOrigin(onBehalfOf),
          unitReference: workUnit?.reference
        };
      })
      .with({ kind: 'system' }, async (): Promise<ApprovalRequester> => {
        const trigger = await this.triggersService.findAnnouncedBy(postId);
        return {
          kind: 'system',
          ...(trigger && { trigger: { reference: trigger.reference.id, source: trigger.source } })
        };
      })
      .exhaustive();
  }

  /** §3.14 — exactly the unit `findServedUnit` names, without the §3.15 exhaustion report's only-unit fallback */
  private async resolveServedUnit(input: RunInput): Promise<ToolTurnScope['workUnit']> {
    const unit = await this.tasksService.findServedUnit({
      agentUsername: input.profile.username,
      channelId: input.channelId,
      triggeringPostId: input.triggeringPostId
    });
    return unit ? { creatorUsername: unit.creatorUsername, reference: renderReference(unit.id) } : null;
  }

  /** everything here may throw; run() owns the boundary so no exit can leave the turn 'running' */
  private async runLoop(input: RunInput, state: TurnState): Promise<TurnOutcome> {
    const { channelId, profile } = input;
    let assembled = await this.contextAssembler.assemble({ channelId, profile });
    await this.loadAssembledContext(state, assembled);
    if (this.exceedsCeiling(input, state)) {
      return this.closeOnContextExhausted(input, state, 'initial');
    }
    if (input.drainedFromPostId !== undefined && !assembled.windowPostIds.has(input.drainedFromPostId)) {
      // §5.2 — the drain is visible even when context is not
      const reachesBackTo = assembled.reachesBackTo && this.dateFormatter.format(assembled.reachesBackTo);
      state.status.appendTrace({ kind: 'note', text: renderDrainLine(reachesBackTo) });
    }
    const client = this.inferenceRegistry.getClientForModel(profile.model);
    let folds = 0;
    for (;;) {
      const steered = await this.absorbSteering(input, state, state.control.takeSteering());
      if (steered) {
        return steered;
      }
      // §3.8 — the ceiling is checked before each completion, so every call the last one made has run
      if ((await this.fitContext(input, state)) === 'exhausted') {
        return this.closeOnContextExhausted(input, state, 'accumulated');
      }
      const completion = await this.complete(input, state, client, assembled.request);
      if (completion === 'killed') {
        return this.close(state, 'killed');
      }
      // §8.2 — the completion was paid for whatever the turn does with it, so its usage is recorded first
      if (!('cutBy' in completion) && completion.success && completion.value.usage) {
        state.usage = addCompletionUsage(state.usage, completion.value.usage);
      }
      // §7.5 — checked after every await, before any dispatch: the honest guarantee of /stop is
      // "no further tool calls and no further posts", not "nothing happened"
      const aborted = state.control.aborted();
      if (aborted) {
        return this.close(state, aborted.kind);
      }
      if ('cutBy' in completion) {
        const outcome =
          completion.cutBy === 'steer'
            ? await this.absorbSteering(input, state, state.control.takeSteering(), completion.usage)
            : await this.concludeOrRetry(input, state, { content: '', kind: 'overran', usage: completion.usage });
        if (outcome) {
          return outcome;
        }
        continue;
      }
      if (!completion.success) {
        return this.closeOnInferenceFailure(input, state, completion.error);
      }
      const folded = this.takeFurtherFragments(state, folds);
      if (folded.length > 0) {
        folds += 1;
        // §3.7 — the newest fragment is the request the prompt should quote, not the one it began on
        state.requestedBy = await this.resolveRequester(folded.at(-1), state.workUnit);
        state.status.appendTrace({ kind: 'note', text: renderFoldLine() });
        assembled = await this.contextAssembler.assemble({ channelId, profile });
        await this.loadAssembledContext(state, assembled);
        if (this.exceedsCeiling(input, state)) {
          return this.closeOnContextExhausted(input, state, 'initial');
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

  private stripRequestOrigin<TOrigin extends TurnRequestOrigin | undefined>(origin: TOrigin): TOrigin {
    return origin?.kind === 'human'
      ? { ...origin, message: this.multiMentionPolicy.stripAgentMentions(origin.message) }
      : origin;
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
      if (
        next.kind === 'unparsed' ||
        !runsConcurrently(next) ||
        this.toolRegistry.parksOnPerson(input.profile, next.call.name)
      ) {
        break;
      }
      batch.push(next);
    }
    return batch;
  }

  /**
   * §4.4 — consumes whatever activation handed this turn while the model was generating, and
   * returns the posts the completion just received is discarded for, none where it stands. Sitting
   * between the completion and every branch that acts on one is what makes "folding only before
   * the first action" structural: past this point a tool has run or a post exists, and
   * re-assembling would throw away work.
   *
   * Absorption closes the moment this turn declines to fold or reaches the last one it will take,
   * so a later fragment finds the §5.2 queue rather than a buffer nothing will read again.
   */
  private takeFurtherFragments(state: TurnState, folds: number): readonly string[] {
    const offered = state.fold.takeOffered();
    const takes = offered.length > 0 && folds < this.limits.foldLimit;
    if (!takes || folds + 1 >= this.limits.foldLimit) {
      state.fold.stopAbsorbing();
    }
    return takes ? offered : [];
  }

  /** best-effort on both writes: a close that itself fails must never leave the turn 'running' silently */
  private async writeClosingStatus(
    state: TurnState,
    status: Exclude<TurnStatus, 'running'>,
    endedBy?: string
  ): Promise<TurnOutcome> {
    try {
      await state.status.close(status, endedBy);
    } catch (error) {
      this.loggingService.error(new Error('failed to close the status post', { cause: error }));
    }
    try {
      await this.turnsService.close(state.turn.id, status, {
        actionCount: state.budget.spentCount,
        usage: state.usage
      });
      this.loggingService.log(
        renderTurnClosedLog({
          actionCount: state.budget.spentCount,
          agentUsername: state.turn.agentUsername,
          channelId: state.turn.channelId,
          elapsedMs: Date.now() - state.turn.startedAt.getTime(),
          status,
          turnId: state.turn.id,
          usage: state.usage
        })
      );
    } catch (error) {
      this.loggingService.error(new Error(`failed to close turn ${state.turn.id} as ${status}`, { cause: error }));
    }
    return {
      contextAssembledAt: state.contextAssembledAt,
      status,
      turnId: state.turn.id,
      windowPostIds: state.windowPostIds
    };
  }
}
