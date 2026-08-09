import { describe, expect, it } from 'vitest';

import { renderPromptResponse } from '../prompt.utils.ts';

describe('renderPromptResponse', () => {
  it('should fence a short prompt whole', () => {
    expect(renderPromptResponse('mira', 'You are Mira.')).toBe(
      'System prompt for @mira in this channel:\n```text\nYou are Mira.\n```'
    );
  });

  it('should truncate an oversized prompt and report the omitted characters', () => {
    const response = renderPromptResponse('mira', 'x'.repeat(20_000));
    expect(response.length).toBeLessThanOrEqual(16_000);
    expect(response).toContain('… [truncated, 4');
    expect(response).toMatch(/characters omitted\]$/u);
  });
});
