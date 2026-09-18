import { renderToolDisplayName } from '@collegium/core/tools';
import { removeTrailingSlash, Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import { CallbackSigner } from '@/chat/callback-auth/callback-signer.service.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { AskStatus, Model, ModelRow } from '@/prisma/prisma.types.ts';
import { createRecordId } from '@/prisma/prisma.utils.ts';

import { renderAskActions, renderAskPrompt, renderResolvedAskPrompt } from './asks.renderer.ts';
import { AskPendingRegistry } from './decisions/ask-pending.registry.ts';
import { resolveActingHuman } from './decisions/human-presence.utils.ts';

import type { AskPromptInput } from './asks.renderer.ts';
import type { AnswerInput, AskDecision, AskFailureRequest, AskRequest } from './asks.types.ts';
import type {
  DecisionFailure,
  PendingCancellationReason,
  PendingDecisionFailure
} from './decisions/decisions.types.ts';

type AskRow = ModelRow<'Ask'> & { turn: { agentUsername: string; channelId: string } };

/** §3.7a — the lifecycle of a question put to the channel: posted, parked, answered or cancelled */
@Injectable()
export class AsksService {
  private readonly answerUrl: string;

  constructor(
    @InjectModel('Ask') private readonly asks: Model<'Ask'>,
    private readonly callbackSigner: CallbackSigner,
    envService: EnvService,
    private readonly loggingService: LoggingService,
    private readonly multiMentionPolicy: MultiMentionPolicy,
    private readonly pendingRegistry: AskPendingRegistry,
    private readonly transportRegistry: TransportRegistry
  ) {
    this.answerUrl = `${removeTrailingSlash(envService.get('APP_PUBLIC_URL'))}/decisions/ask`;
  }

  private static toPromptInput(source: {
    contextText?: string;
    options?: null | readonly string[];
    question: string;
    toolName: string;
    toolNamespace: string;
  }): AskPromptInput {
    return {
      actionName: renderToolDisplayName([source.toolNamespace, source.toolName]),
      ...(source.contextText !== undefined && { contextText: source.contextText }),
      ...(source.options && { options: source.options }),
      question: source.question
    };
  }

  /** one offered option clicked, or the free-text dialog coming back, checked against channel presence (§3.7a) */
  async answer(input: AnswerInput): Promise<Result<void, DecisionFailure>> {
    const loaded = await this.loadForAnswer(input.askId, input.byUserId);
    if (!loaded.success) {
      return loaded;
    }
    const { human, row } = loaded.value;
    if (
      !(await this.applyResolution(row, { answerText: input.answerText, byUsername: human.username, kind: 'answered' }))
    ) {
      return Result.err({ kind: 'already-resolved', pendingId: row.id });
    }
    return Result.ok();
  }

  /** §7.5 — the sweep both channel-scoped commands run, so a parked turn is reachable at all */
  async cancelPendingIn(channelId: string, reason: 'kill' | 'stop'): Promise<number> {
    return this.cancelWhere({ turn: { channelId } }, reason);
  }

  async hasPendingFor(agentUsername: string, channelId: string): Promise<boolean> {
    return (await this.asks.count({ where: { status: 'pending', turn: { agentUsername, channelId } } })) > 0;
  }

  /** §7.3 and §7.4 — a stale question must not be clickable into confusion */
  async invalidateAll(reason: 'halt' | 'restart'): Promise<number> {
    return this.cancelWhere({}, reason);
  }

  /** the free-text path: the answerer is resolved before the dialog opens, so the state names a checked human */
  async openAnswerDialog(input: {
    askId: string;
    byUserId: string;
    triggerId: string | undefined;
  }): Promise<Result<void, DecisionFailure>> {
    const loaded = await this.loadForAnswer(input.askId, input.byUserId);
    if (!loaded.success) {
      return loaded;
    }
    const { human, row } = loaded.value;
    if (input.triggerId === undefined) {
      return Result.err({ kind: 'dialog-undeliverable', message: 'the click carried no trigger id' });
    }
    const opened = await this.transportRegistry.get(row.turn.agentUsername).openDialog({
      callbackId: row.id,
      elements: [{ displayName: 'Answer', name: 'answer', type: 'textarea' }],
      state: JSON.stringify({
        byUsername: human.username,
        signature: this.callbackSigner.sign(['ask-answer', row.id, human.username])
      }),
      submitLabel: 'Answer',
      title: `Answer ${renderToolDisplayName([row.toolNamespace, row.toolName])}`,
      triggerId: input.triggerId,
      url: `${this.answerUrl}/answer`
    });
    if (!opened.success) {
      return Result.err({ kind: 'dialog-undeliverable', message: opened.error.message });
    }
    return Result.ok();
  }

  /**
   * Posts the question under the agent's own account and blocks — for days if necessary (§3.7a).
   * The resolver is registered before the row exists: a cancellation sweep that finds the row must
   * always find a resolver to fire, or the turn it belongs to would park forever.
   */
  async request(request: AskRequest): Promise<Result<AskDecision, AskFailureRequest>> {
    // §4.5 — the question posts under the agent's account and addresses people; a peer named in it would be activated
    const input: AskRequest = {
      ...request,
      ...(request.options && {
        options: request.options.map((option) => this.multiMentionPolicy.stripAgentMentions(option))
      }),
      question: this.multiMentionPolicy.stripAgentMentions(request.question)
    };
    const askId = createRecordId();
    const pendingDecision = new Promise<AskDecision>((resolve) => {
      this.pendingRegistry.register({ channelId: input.channelId, id: askId, resolve });
    });
    await this.asks.create({
      data: {
        id: askId,
        ...(input.options && { options: [...input.options] }),
        question: input.question,
        status: 'pending',
        toolName: input.toolName,
        toolNamespace: input.toolNamespace,
        turnId: input.turnId
      }
    });
    const posted = await this.postPrompt(input, askId);
    if (!posted.success) {
      // the rollback is "un-create", not "resolve": there is no prompt to rewrite and no answer to fire
      this.pendingRegistry.take(askId);
      await this.claimPending(askId, 'invalidated');
      return posted;
    }
    await this.asks.updateMany({ data: { promptPostId: posted.value.postId }, where: { id: askId } });
    await this.rewriteIfResolvedMeanwhile(input, askId, posted.value.postId, pendingDecision);
    await input.appendEvent({
      askId,
      callId: input.callId,
      kind: 'ask_requested',
      ...(input.options && { options: [...input.options] }),
      question: input.question,
      toolName: [input.toolNamespace, input.toolName]
    });
    const decision = await pendingDecision;
    if (decision.kind === 'answered') {
      await input.appendEvent({
        answerText: decision.answerText,
        askId,
        byUsername: decision.byUsername,
        callId: input.callId,
        kind: 'ask_answered'
      });
    }
    return Result.ok(decision);
  }

  /** the atomic pending→terminal transition: exactly one answer wins a given row (§3.7a) */
  private async applyResolution(row: AskRow, decision: AskDecision): Promise<boolean> {
    const claimed = await this.claimPending(
      row.id,
      decision.kind === 'answered' ? 'answered' : 'invalidated',
      decision.kind === 'answered' ? { answeredByUsername: decision.byUsername, answerText: decision.answerText } : {}
    );
    if (!claimed) {
      return false;
    }
    await this.rewritePrompt(
      row.turn.agentUsername,
      row.promptPostId,
      renderResolvedAskPrompt(AsksService.toPromptInput(row), decision)
    );
    this.pendingRegistry.take(row.id)?.resolve(decision);
    return true;
  }

  private async cancelWhere(
    where: { turn?: { channelId: string } },
    reason: PendingCancellationReason
  ): Promise<number> {
    const pending = await this.asks.findMany({ include: { turn: true }, where: { ...where, status: 'pending' } });
    let cancelled = 0;
    for (const row of pending) {
      if (await this.applyResolution(row, { kind: 'cancelled', reason })) {
        cancelled += 1;
      }
    }
    return cancelled;
  }

  /** the ONLY pending→terminal write: whoever wins this update owns the row's ending */
  private async claimPending(
    askId: string,
    status: Exclude<AskStatus, 'pending'>,
    fields: { answeredByUsername?: string; answerText?: string } = {}
  ): Promise<boolean> {
    const claimed = await this.asks.updateMany({
      data: { answeredAt: new Date(), status, ...fields },
      where: { id: askId, status: 'pending' }
    });
    return claimed.count > 0;
  }

  private async loadForAnswer(
    askId: string,
    byUserId: string
  ): Promise<Result<{ human: { username: string }; row: AskRow }, DecisionFailure>> {
    const row = await this.asks.findUnique({ include: { turn: true }, where: { id: askId } });
    if (!row) {
      return Result.err({ kind: 'not-found', pendingId: askId });
    }
    const human = await resolveActingHuman(
      this.transportRegistry,
      row.turn.agentUsername,
      row.turn.channelId,
      byUserId
    );
    if (!human.success) {
      return human;
    }
    return Result.ok({ human: human.value, row });
  }

  private async postPrompt(
    input: AskRequest,
    askId: string
  ): Promise<Result<{ postId: string }, PendingDecisionFailure.PromptUndeliverable>> {
    const sent = await this.transportRegistry.get(input.agentUsername).send({
      attachments: renderAskActions({
        answerUrl: this.answerUrl,
        askId,
        ...(input.options && { options: input.options }),
        sign: (parts) => this.callbackSigner.sign(parts)
      }),
      channelId: input.channelId,
      text: renderAskPrompt(AsksService.toPromptInput(input))
    });
    if (!sent.success) {
      return Result.err({ kind: 'prompt-undeliverable', message: sent.error.message });
    }
    return Result.ok({ postId: sent.value.postId });
  }

  /** an answer that raced the prompt's own posting found no post id — rewrite it now (§3.7a) */
  private async rewriteIfResolvedMeanwhile(
    input: AskRequest,
    askId: string,
    promptPostId: string,
    pendingDecision: Promise<AskDecision>
  ): Promise<void> {
    const current = await this.asks.findFirst({ select: { status: true }, where: { id: askId } });
    if (current?.status === 'pending') {
      return;
    }
    const decision = await pendingDecision;
    await this.rewritePrompt(
      input.agentUsername,
      promptPostId,
      renderResolvedAskPrompt(AsksService.toPromptInput(input), decision)
    );
  }

  private async rewritePrompt(agentUsername: string, promptPostId: null | string, text: string): Promise<void> {
    if (promptPostId === null) {
      return;
    }
    const updated = await this.transportRegistry.get(agentUsername).updatePost(promptPostId, {
      attachments: [],
      text
    });
    if (!updated.success) {
      this.loggingService.error(new Error(`failed to rewrite ask prompt ${promptPostId}: ${updated.error.message}`));
    }
  }
}
