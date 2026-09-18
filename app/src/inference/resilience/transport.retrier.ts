import type { $InferenceRetryPolicy } from '@collegium/config';
import type { Result } from '@collegium/core/utils';
import { delay } from 'es-toolkit';

import { InferenceClient } from '../inference.client.ts';

import type { CompletionOptions, CompletionRequest, CompletionResult, InferenceFailure } from '../inference.types.ts';

export class TransportRetrier extends InferenceClient {
  constructor(
    private readonly inner: InferenceClient,
    private readonly policy: $InferenceRetryPolicy
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
      const retryAfterMs = result.error.kind === 'transport' ? result.error.retryAfterMs : undefined;
      await delay(retryAfterMs ?? this.policy.backoffMs * 2 ** (attempt - 1));
      if (options.signal?.aborted) {
        return result;
      }
      result = await this.inner.complete(request, options);
    }
    return result;
  }
}
