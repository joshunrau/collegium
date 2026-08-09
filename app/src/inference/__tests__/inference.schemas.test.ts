import { describe, expect, it } from 'vitest';

import { $ChatCompletion } from '../inference.schemas.ts';

describe('$ChatCompletion', () => {
  it('should be defined', () => {
    expect($ChatCompletion).toBeDefined();
  });
});
