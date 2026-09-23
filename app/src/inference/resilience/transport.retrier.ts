import type { $InferenceRetryPolicy } from '@collegium/config';
import type { Result } from '@collegium/core/utils';
import { delay } from 'es-toolkit';

import type { LoggingService } from '@/logging/logging.service.ts';

import { InferenceClient } from '../inference.client.ts';
import { describeInferenceFailure } from '../inference.utils.ts';

import type { CompletionOptions, CompletionRequest, CompletionResult, InferenceFailure } from '../inference.types.ts';

/** the most a backoff is shortened at random, as a fraction of it */
const JITTER_RATIO = 0.25;

export class TransportRetrier extends InferenceClient {
  constructor(
    private readonly inner: InferenceClient,
    private readonly policy: $InferenceRetryPolicy,
    private readonly loggingService: Pick<LoggingService, 'warn'>,
    private readonly random: () => number = Math.random
  ) {
    super();
  }

  /** §7.2 — a malformed completion is a delivery the provider got wrong, retried as transport */
  private static isRetried(failure: InferenceFailure): boolean {
    return failure.kind === 'transport' || failure.kind === 'malformed';
  }

  /** an aborted request is never retried: its turn is gone, and a retry would spend a full prompt on nobody */
  async complete(
    request: CompletionRequest,
    options: CompletionOptions = {}
  ): Promise<Result<CompletionResult, InferenceFailure>> {
    let result = await this.inner.complete(request, options);
    for (let attempt = 1; attempt < this.policy.maxAttempts; attempt++) {
      if (result.success || !TransportRetrier.isRetried(result.error) || options.signal?.aborted) {
        return result;
      }
      const waitMs = this.measureWaitBefore(attempt, result.error);
      if (waitMs === undefined) {
        return result;
      }
      this.loggingService.warn(
        `retrying a completion for ${request.model.provider}/${request.model.name} in ${Math.round(waitMs)}ms (attempt ${attempt + 1} of ${this.policy.maxAttempts}): ${describeInferenceFailure(result.error)}`
      );
      await delay(waitMs);
      if (options.signal?.aborted) {
        return result;
      }
      result = await this.inner.complete(request, options);
    }
    return result;
  }

  /** §7.2 — a wait the provider asked for is honoured as asked up to the cap, and one past it is no retry at all */
  private measureWaitBefore(attempt: number, failure: InferenceFailure): number | undefined {
    const retryAfterMs = failure.kind === 'transport' ? failure.retryAfterMs : undefined;
    if (retryAfterMs !== undefined) {
      return retryAfterMs <= this.policy.maxDelayMs ? retryAfterMs : undefined;
    }
    const backoffMs = Math.min(this.policy.maxDelayMs, this.policy.backoffMs * 2 ** (attempt - 1));
    return backoffMs * (1 - JITTER_RATIO * this.random());
  }
}
