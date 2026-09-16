import { describe, expect, it } from 'vitest';

import { $ChatCompletion } from '../inference.schemas.ts';

describe('$ChatCompletion', () => {
  it('should be defined', () => {
    expect($ChatCompletion).toBeDefined();
  });

  it('should accept native DeepSeek cache usage while preferring the normalized counter, including zero', () => {
    const response = {
      choices: [{ message: { content: 'done' } }],
      usage: { completion_tokens: 10, prompt_cache_hit_tokens: 100, prompt_tokens: 200 }
    };
    expect($ChatCompletion.parse(response).usage?.cachedPromptTokens).toBe(100);
    expect(
      $ChatCompletion.parse({
        ...response,
        usage: { ...response.usage, prompt_tokens_details: { cached_tokens: 0 } }
      }).usage?.cachedPromptTokens
    ).toBe(0);
  });
});
