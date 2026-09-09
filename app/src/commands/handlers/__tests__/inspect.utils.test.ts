import { describe, expect, it } from 'vitest';

import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';

import { renderInspectResponse } from '../inspect.utils.ts';

import type { InspectReport } from '../inspect.utils.ts';

const REPORT: InspectReport = {
  profile: buildAgentProfile(),
  prompt: 'You are Mira.',
  skills: [
    { description: 'How to hand work over.', name: 'handing-work-to-a-peer' },
    { description: 'How to bookmark.', name: 'bookmark::saving-bookmarks' }
  ],
  tools: [
    ['clock', 'now'],
    ['bookmark', 'save'],
    ['bookmark', 'list']
  ]
};

describe('renderInspectResponse', () => {
  it('should group tools and skills by namespace, framework skills under their own label', () => {
    expect(renderInspectResponse(REPORT)).toContain(
      ['Tools:', '- clock: now', '- bookmark: save, list', '', 'Skills:', '- framework:'].join('\n')
    );
    expect(renderInspectResponse(REPORT)).toContain('- bookmark:\n  - saving-bookmarks — How to bookmark.');
  });

  it('should truncate only the prompt and report the omitted characters', () => {
    const response = renderInspectResponse({ ...REPORT, prompt: 'x'.repeat(20_000) });
    expect(response.length).toBeLessThanOrEqual(16_000);
    expect(response).toContain('- bookmark: save, list');
    expect(response).toMatch(/… \[truncated, \d+ characters omitted\]$/u);
  });
});
