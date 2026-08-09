import type { Result } from '@collegium/core/utils';

import type { CompletionRequest, CompletionResult, InferenceFailure } from './inference.types.ts';

export abstract class InferenceClient {
  abstract complete(request: CompletionRequest): Promise<Result<CompletionResult, InferenceFailure>>;
}
