import type { ToolFailure } from '../tools.ts';

/** what `err.invalidArguments` and `err.unresolved` throw; the perimeter wrapper catches it and nothing else */
export class PluginToolFailureError extends Error {
  readonly failure: ToolFailure.InvalidArguments | ToolFailure.Unresolved;

  constructor(failure: ToolFailure.InvalidArguments | ToolFailure.Unresolved) {
    super(failure.message);
    this.failure = failure;
  }
}
