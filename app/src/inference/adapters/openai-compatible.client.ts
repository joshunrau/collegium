import { removeTrailingSlash, Result } from '@collegium/core/utils';
import { match } from 'ts-pattern';

import { InferenceClient } from '../inference.client.ts';
import { $CompletionChunk } from '../inference.schemas.ts';
import { reasoningOf } from '../inference.utils.ts';
import { createIdleAbort } from '../resilience/idle-abort.utils.ts';
import { containsLeakedCall } from './leaked-call.utils.ts';
import { isContextOverflowBody, parseRetryAfterMs, toCompletionBody } from './openai-compatible.utils.ts';
import { readServerSentEvents } from './sse.utils.ts';
import { StreamAssembler } from './stream.assembler.ts';
import { classifyTransportError } from './transport-reason.utils.ts';

import type {
  CompletionOptions,
  CompletionReasoning,
  CompletionRequest,
  CompletionResult,
  InferenceFailure,
  ToolCall,
  UnparsedToolCall
} from '../inference.types.ts';
import type { AssembledCompletion } from './stream.assembler.ts';

const MALFORMED_COMPLETION: InferenceFailure.Malformed = {
  kind: 'malformed',
  message: 'completion response was malformed'
};

const RETRYABLE_STATUSES = new Set([408, 429]);

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status) || status >= 500;
}

/**
 * Every completion streams: the idle abort counts the bytes as they arrive, so a provider that
 * thinks for ten minutes is served and one that has gone quiet is cut, and a kill aborts the
 * request in flight instead of letting it run to its end for nobody.
 */
export class OpenAICompatibleClient extends InferenceClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly providerLabel: string;
  private readonly timeoutMs: number;

  constructor(config: { apiKey: string; baseUrl: string; timeoutMs: number }, providerLabel: string) {
    super();
    this.apiKey = config.apiKey;
    this.endpoint = `${removeTrailingSlash(config.baseUrl)}/chat/completions`;
    this.providerLabel = providerLabel;
    this.timeoutMs = config.timeoutMs;
  }

  async complete(
    request: CompletionRequest,
    options: CompletionOptions = {}
  ): Promise<Result<CompletionResult, InferenceFailure>> {
    const idle = createIdleAbort(this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([idle.signal, options.signal]) : idle.signal;
    try {
      const response = await this.post(request, signal);
      if (!response.success) {
        return response;
      }
      if (!response.value.ok) {
        return this.classifyFailure(response.value);
      }
      return await this.readStream(response.value, idle.touch, options.onStreamed);
    } finally {
      idle.clear();
    }
  }

  private async classifyFailure(response: Response): Promise<Result<never, InferenceFailure>> {
    if (isRetryableStatus(response.status)) {
      const retryAfterMs = parseRetryAfterMs(response.headers, Date.now());
      return Result.err({
        kind: 'transport',
        reason: 'http_status',
        status: response.status,
        ...(retryAfterMs !== undefined && { retryAfterMs })
      } satisfies InferenceFailure.Transport);
    }
    const body = await response.text().catch(() => undefined);
    if (isContextOverflowBody(body ?? '')) {
      return Result.err({
        kind: 'context-overflow',
        status: response.status
      } satisfies InferenceFailure.ContextOverflow);
    }
    const status = `${this.providerLabel} responded with status ${response.status}`;
    return Result.err({
      kind: 'provider',
      message: body === undefined ? status : `${status}: ${body}`,
      status: response.status
    } satisfies InferenceFailure.Provider);
  }

  /** an error object in the stream is the provider's refusal arriving late, classified as its status would have been */
  private classifyStreamError(error: NonNullable<AssembledCompletion['error']>): Result<never, InferenceFailure> {
    const status = typeof error.code === 'number' ? error.code : undefined;
    if (status !== undefined && isRetryableStatus(status)) {
      return Result.err({ kind: 'transport', reason: 'http_status', status } satisfies InferenceFailure.Transport);
    }
    if (isContextOverflowBody(error.message)) {
      return Result.err({
        kind: 'context-overflow',
        ...(status !== undefined && { status })
      } satisfies InferenceFailure.ContextOverflow);
    }
    return Result.err({
      kind: 'provider',
      message: `${this.providerLabel} reported an error mid-stream: ${error.message}`,
      ...(status !== undefined && { status })
    } satisfies InferenceFailure.Provider);
  }

  private parseJson(data: string): unknown {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return undefined;
    }
  }

  private async post(
    request: CompletionRequest,
    signal: AbortSignal
  ): Promise<Result<Response, InferenceFailure.Transport>> {
    try {
      const response = await fetch(this.endpoint, {
        body: JSON.stringify(toCompletionBody(request)),
        headers: {
          accept: 'text/event-stream',
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json'
        },
        method: 'POST',
        signal
      });
      return Result.ok(response);
    } catch (error) {
      return Result.err(classifyTransportError(error));
    }
  }

  private async readStream(
    response: Response,
    touch: () => void,
    onStreamed: CompletionOptions['onStreamed']
  ): Promise<Result<CompletionResult, InferenceFailure>> {
    if (!response.body) {
      return Result.err(MALFORMED_COMPLETION);
    }
    const assembler = new StreamAssembler();
    let finished = false;
    try {
      for await (const data of readServerSentEvents(response.body, touch)) {
        if (data === '[DONE]') {
          finished = true;
          break;
        }
        const chunk = $CompletionChunk.safeParse(this.parseJson(data));
        if (!chunk.success) {
          return Result.err(MALFORMED_COMPLETION);
        }
        assembler.absorb(chunk.data);
        onStreamed?.(assembler.streamed);
        if (assembler.failed) {
          break;
        }
      }
    } catch (error) {
      return Result.err(classifyTransportError(error));
    }
    return this.toCompletion(assembler.finish(), finished);
  }

  /**
   * §7.1 by finish reason: cut at the output limit is fed back for a shorter attempt; filtered is
   * the provider's refusal; interrupted is the provider's own failure and is retried like any other
   * transport fault; a stream that ended without saying why is a connection lost mid-body.
   */
  private toCompletion(assembled: AssembledCompletion, finished: boolean): Result<CompletionResult, InferenceFailure> {
    if (assembled.error) {
      return this.classifyStreamError(assembled.error);
    }
    if (!finished && assembled.finishReason === undefined) {
      return Result.err({
        detail: 'the stream ended before the completion finished',
        kind: 'transport',
        reason: 'reset'
      } satisfies InferenceFailure.Transport);
    }
    const reasoning = reasoningOf(assembled);
    return match<string | undefined, Result<CompletionResult, InferenceFailure>>(assembled.finishReason)
      .with('length', () => {
        return Result.ok({
          content: assembled.content,
          kind: 'truncated',
          usage: assembled.usage,
          ...(assembled.servedBy !== undefined && { servedBy: assembled.servedBy }),
          ...reasoning
        });
      })
      .with('content_filter', () => {
        return Result.err({ kind: 'provider', message: `${this.providerLabel} filtered the completion` });
      })
      .with('insufficient_system_resource', 'aborted', (reason) => {
        return Result.err({ detail: `finish_reason ${reason}`, kind: 'transport', reason: 'interrupted' });
      })
      .otherwise(() => this.toOutput(assembled, reasoning));
  }

  private toOutput(
    assembled: AssembledCompletion,
    reasoning: CompletionReasoning
  ): Result<CompletionResult, InferenceFailure> {
    if (assembled.toolCalls.length > 0) {
      const toolCalls: (ToolCall | UnparsedToolCall)[] = [];
      for (const call of assembled.toolCalls) {
        // a call with no identity cannot be answered or named to a human; broken arguments can be both (§7.2)
        if (call.id === '' || call.name === '') {
          return Result.err(MALFORMED_COMPLETION);
        }
        const args = this.parseJson(call.arguments);
        toolCalls.push(
          args === undefined
            ? { id: call.id, name: call.name, rawArguments: call.arguments }
            : { arguments: args, id: call.id, name: call.name }
        );
      }
      return Result.ok({
        content: assembled.content,
        kind: 'tool-use',
        toolCalls,
        usage: assembled.usage,
        ...(assembled.servedBy !== undefined && { servedBy: assembled.servedBy }),
        ...reasoning
      } satisfies CompletionResult.ToolUse);
    }
    if (assembled.content.trim() === '') {
      return Result.err({ kind: 'malformed', message: 'completion returned empty content' });
    }
    if (containsLeakedCall(assembled.content)) {
      return Result.ok({
        content: assembled.content,
        kind: 'leaked-call',
        usage: assembled.usage,
        ...(assembled.servedBy !== undefined && { servedBy: assembled.servedBy }),
        ...reasoning
      } satisfies CompletionResult.LeakedCall);
    }
    return Result.ok({
      content: assembled.content,
      kind: 'text',
      usage: assembled.usage,
      ...(assembled.servedBy !== undefined && { servedBy: assembled.servedBy }),
      ...reasoning
    } satisfies CompletionResult.Text);
  }
}
