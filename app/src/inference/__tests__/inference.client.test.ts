import { describe, expect, it } from 'vitest';

import { InferenceClient } from '../inference.client.ts';

describe('InferenceClient', () => {
  it('should be defined', () => {
    expect(InferenceClient).toBeDefined();
  });
});
