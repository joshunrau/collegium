import type { ReasoningDetail } from '@/core/core.types.ts';

import type { $CompletionChunk, $CompletionDelta, $ToolCallDelta } from '../inference.schemas.ts';
import type { CompletionUsage } from '../inference.types.ts';

function joinText(left: string | undefined, right: string | undefined): string | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? '') + (right ?? '');
}

/** a block continued in the next chunk: its text grows, and the signature the provider sends last is the one that counts */
function continueDetail(previous: ReasoningDetail, next: ReasoningDetail): ReasoningDetail {
  const joined = {
    data: joinText(previous.data, next.data),
    signature: next.signature ?? previous.signature,
    summary: joinText(previous.summary, next.summary),
    text: joinText(previous.text, next.text)
  };
  return {
    ...previous,
    ...next,
    ...Object.fromEntries(Object.entries(joined).filter(([, value]) => value !== undefined))
  };
}

/** a tool call as the stream delivered it: the arguments still the JSON text the model wrote, decoded once the stream ends */
export type AssembledToolCall = {
  readonly arguments: string;
  readonly id: string;
  readonly name: string;
};

export type AssembledCompletion = {
  readonly content: string;
  readonly error: undefined | { code: number | string | undefined; message: string };
  readonly finishReason: string | undefined;
  readonly reasoningContent: string | undefined;
  readonly reasoningDetails: readonly ReasoningDetail[] | undefined;
  readonly toolCalls: readonly AssembledToolCall[];
  readonly usage: CompletionUsage | undefined;
};

/**
 * The completion a stream adds up to. Text and reasoning concatenate; a tool call accumulates
 * under the index its deltas name; a reasoning block continues across chunks that share its index.
 */
export class StreamAssembler {
  private content = '';
  private error: AssembledCompletion['error'];
  private finishReason: string | undefined;
  private reasoningContent: string | undefined;
  private reasoningDetails: ReasoningDetail[] | undefined;
  private readonly toolCalls = new Map<number, AssembledToolCall>();
  private usage: CompletionUsage | undefined;

  /** the provider reported an error mid-stream; nothing after it is a completion */
  get failed(): boolean {
    return this.error !== undefined;
  }

  absorb(chunk: $CompletionChunk): void {
    if (chunk.error) {
      this.error = { code: chunk.error.code ?? undefined, message: chunk.error.message };
    }
    if (chunk.usage) {
      this.usage = chunk.usage;
    }
    for (const choice of chunk.choices ?? []) {
      if (choice.finish_reason) {
        this.finishReason = choice.finish_reason;
      }
      if (choice.delta) {
        this.absorbDelta(choice.delta);
      }
    }
  }

  finish(): AssembledCompletion {
    return {
      content: this.content,
      error: this.error,
      finishReason: this.finishReason,
      reasoningContent: this.reasoningContent,
      reasoningDetails: this.reasoningDetails,
      toolCalls: Array.from(this.toolCalls.entries())
        .toSorted(([left], [right]) => left - right)
        .map(([, call]) => call),
      usage: this.usage
    };
  }

  private absorbDelta(delta: $CompletionDelta): void {
    if (delta.content) {
      this.content += delta.content;
    }
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (reasoning !== undefined && reasoning !== null) {
      this.reasoningContent = (this.reasoningContent ?? '') + reasoning;
    }
    for (const detail of delta.reasoning_details ?? []) {
      this.absorbDetail(detail);
    }
    for (const call of delta.tool_calls ?? []) {
      this.absorbToolCall(call);
    }
  }

  private absorbDetail(detail: ReasoningDetail): void {
    this.reasoningDetails ??= [];
    const last = this.reasoningDetails.at(-1);
    if (last !== undefined && detail.index !== undefined && last.index === detail.index) {
      this.reasoningDetails[this.reasoningDetails.length - 1] = continueDetail(last, detail);
      return;
    }
    this.reasoningDetails.push(detail);
  }

  /** a delta names its call by index; one without an index starts a call when it carries an id, else continues the last */
  private absorbToolCall(delta: $ToolCallDelta): void {
    const index = delta.index ?? (delta.id ? this.toolCalls.size : Math.max(this.toolCalls.size - 1, 0));
    const call = this.toolCalls.get(index) ?? { arguments: '', id: '', name: '' };
    this.toolCalls.set(index, {
      arguments: call.arguments + (delta.function?.arguments ?? ''),
      id: call.id || (delta.id ?? ''),
      name: call.name || (delta.function?.name ?? '')
    });
  }
}
