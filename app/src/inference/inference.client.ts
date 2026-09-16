import type { Result } from '@collegium/core/utils';

import type { CompletionOptions, CompletionRequest, CompletionResult, InferenceFailure } from './inference.types.ts';

export abstract class InferenceClient {
  abstract complete(
    request: CompletionRequest,
    options?: CompletionOptions
  ): Promise<Result<CompletionResult, InferenceFailure>>;
}
