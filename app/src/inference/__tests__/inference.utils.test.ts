import { describe, expect, it } from 'vitest';

import { describeInferenceFailure } from '../inference.utils.ts';

describe('describeInferenceFailure', () => {
  it('should carry the provider’s own words, which are what name a rejected request', () => {
    expect(
      describeInferenceFailure({ kind: 'provider', message: 'deepseek responded with status 400: bad schema' })
    ).toBe('the provider rejected the request: deepseek responded with status 400: bad schema');
  });

  it('should name the status of a transport failure when there was one to report', () => {
    expect(describeInferenceFailure({ kind: 'transport', status: 503 })).toBe(
      'the provider could not be reached (status 503)'
    );
    expect(describeInferenceFailure({ kind: 'transport' })).toBe('the provider could not be reached');
  });

  it('should describe a malformed completion', () => {
    expect(describeInferenceFailure({ kind: 'malformed', message: 'completion returned empty content' })).toBe(
      'the completion was malformed: completion returned empty content'
    );
  });
});
