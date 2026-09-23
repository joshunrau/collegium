import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderMemoryBaseline } from '../memory.baseline.ts';

const MEMORY_CAPS = { maxBodyChars: 16_000, maxDescriptionChars: 200, maxEntries: 50 };

describe('renderMemoryBaseline', () => {
  it('should render only for an agent that holds memory (§3.8)', () => {
    expect(renderMemoryBaseline(buildStablePromptInput())).toBeUndefined();
    expect(renderMemoryBaseline(buildStablePromptInput({ memoryCaps: MEMORY_CAPS }))).toContain(
      'Memory is for what a later turn will need and cannot look up'
    );
  });

  it('should count work units and a tool’s own records among what a tool can fetch again', () => {
    expect(renderMemoryBaseline(buildStablePromptInput({ memoryCaps: MEMORY_CAPS }))).toContain(
      'Do not put in memory what a tool can fetch again: channel messages, mail, search results, workspace files, work units and records a tool keeps.'
    );
  });
});
