import { removeTrailingSlash, Result } from '@collegium/core/utils';

import { InferenceClient } from '../inference.client.ts';
import { $ChatCompletion } from '../inference.schemas.ts';
import { toCompletionBody } from './openai-compatible.utils.ts';

import type { CompletionRequest, CompletionResult, InferenceFailure } from '../inference.types.ts';

const MALFORMED_COMPLETION: InferenceFailure.Malformed = {
  kind: 'malformed',
  message: 'completion response was malformed'
};

const RETRYABLE_STATUSES = new Set([408, 429]);

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

  async complete(request: CompletionRequest): Promise<Result<CompletionResult, InferenceFailure>> {
    const response = await this.post(request);
    if (!response.success) {
      return response;
    }
    return this.readCompletion(response.value);
  }

  private async classifyFailure(response: Response): Promise<Result<never, InferenceFailure>> {
    if (RETRYABLE_STATUSES.has(response.status) || response.status >= 500) {
      return Result.err({ kind: 'transport', status: response.status } satisfies InferenceFailure.Transport);
    }
    const body = await response.text().catch(() => undefined);
    const status = `${this.providerLabel} responded with status ${response.status}`;
    return Result.err({
      kind: 'provider',
      message: body === undefined ? status : `${status}: ${body}`,
      status: response.status
    } satisfies InferenceFailure.Provider);
  }

  private parseCompletion(body: unknown): Result<CompletionResult, InferenceFailure.Malformed> {
    const parsed = $ChatCompletion.safeParse(body);
    if (!parsed.success) {
      return Result.err(MALFORMED_COMPLETION);
    }
    const message = parsed.data.choices[0]?.message;
    if (!message) {
      return Result.err(MALFORMED_COMPLETION);
    }
    const usage = parsed.data.usage;
    if (message.toolCalls.length > 0) {
      return Result.ok({
        content: message.content ?? '',
        kind: 'tool-use',
        toolCalls: message.toolCalls.map((call) => ({
          arguments: call.function.arguments,
          id: call.id,
          name: call.function.name
        })),
        usage
      } satisfies CompletionResult.ToolUse);
    }
    if (!message.content || message.content.trim() === '') {
      return Result.err({ kind: 'malformed', message: 'completion returned empty content' });
    }
    return Result.ok({ content: message.content, kind: 'text', usage } satisfies CompletionResult.Text);
  }

  private async post(request: CompletionRequest): Promise<Result<Response, InferenceFailure.Transport>> {
    try {
      const response = await fetch(this.endpoint, {
        body: JSON.stringify(toCompletionBody(request)),
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json'
        },
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      return Result.ok(response);
    } catch {
      return Result.err({ kind: 'transport' });
    }
  }

  private async readCompletion(response: Response): Promise<Result<CompletionResult, InferenceFailure>> {
    if (!response.ok) {
      return this.classifyFailure(response);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      // json() throws SyntaxError only once the body has arrived whole; any other rejection is the
      // wire failing mid-read, e.g. the timeout signal firing while the body stalls
      if (error instanceof SyntaxError) {
        return Result.err(MALFORMED_COMPLETION);
      }
      return Result.err({ kind: 'transport' });
    }
    return this.parseCompletion(body);
  }
}
