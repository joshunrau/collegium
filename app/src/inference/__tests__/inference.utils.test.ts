import { describe, expect, it } from 'vitest';

import { describeInferenceFailure } from '../inference.utils.ts';

describe('describeInferenceFailure', () => {
  it('should carry the provider’s own words, which are what name a rejected request', () => {
    expect(
      describeInferenceFailure({ kind: 'provider', message: 'deepseek responded with status 400: bad schema' })
    ).toBe('the provider rejected the request: deepseek responded with status 400: bad schema');
  });

  it('should name the reason a transport failure carries, and the runtime’s detail for the log', () => {
    expect(describeInferenceFailure({ kind: 'transport', reason: 'http_status', status: 503 })).toBe(
      'the provider could not be reached: the provider answered HTTP 503'
    );
    expect(
      describeInferenceFailure({ detail: 'TimeoutError: timed out', kind: 'transport', reason: 'response_timeout' })
    ).toBe(
      'the provider could not be reached: the provider accepted the request but sent nothing within the inference timeout [TimeoutError: timed out]'
    );
    expect(describeInferenceFailure({ kind: 'transport', reason: 'unknown' })).toBe(
      'the provider could not be reached'
    );
  });

  it('should describe a malformed completion', () => {
    expect(describeInferenceFailure({ kind: 'malformed', message: 'completion returned empty content' })).toBe(
      'the completion was malformed: completion returned empty content'
    );
  });
});
