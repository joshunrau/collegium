import type { $InferenceRetryPolicy } from '@collegium/config';
import type { Result } from '@collegium/core/utils';
import { delay } from 'es-toolkit';

import { InferenceClient } from '../inference.client.ts';

import type { CompletionRequest, CompletionResult, InferenceFailure } from '../inference.types.ts';

export class TransportRetrier extends InferenceClient {
  constructor(
    private readonly inner: InferenceClient,
    private readonly policy: $InferenceRetryPolicy
  ) {
    super();
  }

  async complete(request: CompletionRequest): Promise<Result<CompletionResult, InferenceFailure>> {
    let result = await this.inner.complete(request);
    for (let attempt = 1; attempt < this.policy.maxAttempts; attempt++) {
      if (result.success || result.error.kind !== 'transport') {
        return result;
      }
      await delay(result.error.retryAfterMs ?? this.policy.backoffMs * 2 ** (attempt - 1));
      result = await this.inner.complete(request);
    }
    return result;
  }
}
