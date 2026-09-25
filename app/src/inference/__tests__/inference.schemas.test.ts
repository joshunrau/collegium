import { describe, expect, it } from 'vitest';

import { $CompletionChunk } from '../inference.schemas.ts';

describe('$CompletionChunk', () => {
  it('should accept native DeepSeek cache usage while preferring the normalized counter, including zero', () => {
    const chunk = {
      choices: [],
      usage: { completion_tokens: 10, prompt_cache_hit_tokens: 100, prompt_tokens: 200 }
    };
    expect($CompletionChunk.parse(chunk).usage?.cachedPromptTokens).toBe(100);
    expect(
      $CompletionChunk.parse({
        ...chunk,
        usage: { ...chunk.usage, prompt_tokens_details: { cached_tokens: 0 } }
      }).usage?.cachedPromptTokens
    ).toBe(0);
  });

  it('should read the upstream a router names, and none where it names none (§8.2)', () => {
    expect($CompletionChunk.parse({ choices: [], provider: 'Novita' }).provider).toBe('Novita');
    expect($CompletionChunk.parse({ choices: [] }).provider).toBeUndefined();
  });

  it('should keep every field of a reasoning block under its wire name', () => {
    const chunk = $CompletionChunk.parse({
      choices: [
        {
          delta: {
            reasoning_details: [
              { format: 'anthropic-claude-v1', index: 0, signature: 'sig', text: 'hm', type: 'reasoning.text' }
            ]
          }
        }
      ]
    });
    expect(chunk.choices?.[0]?.delta?.reasoning_details).toStrictEqual([
      { format: 'anthropic-claude-v1', index: 0, signature: 'sig', text: 'hm', type: 'reasoning.text' }
    ]);
  });
});
