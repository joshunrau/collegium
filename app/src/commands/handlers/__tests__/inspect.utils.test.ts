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
    { gates: false, id: ['clock', 'now'] },
    { gates: true, id: ['bookmark', 'save'] },
    { gates: false, id: ['bookmark', 'list'] }
  ]
};

const UNGATED: InspectReport = { ...REPORT, tools: [{ gates: false, id: ['clock', 'now'] }] };

describe('renderInspectResponse', () => {
  it('should group tools and skills by namespace, framework skills under their own label', () => {
    expect(renderInspectResponse(REPORT)).toContain(
      ['Tools:', '- clock: now', '- bookmark: save 🔐, list', '', '🔐'].join('\n')
    );
    expect(renderInspectResponse(REPORT)).toContain('- bookmark:\n  - saving-bookmarks — How to bookmark.');
  });

  it('should mark a gated tool beside its ungated neighbours in the same namespace (§3.4)', () => {
    expect(renderInspectResponse(REPORT)).toContain('- bookmark: save 🔐, list');
    expect(renderInspectResponse(UNGATED)).toContain('- clock: now\n');
  });

  it('should show the gate legend only when a listed tool gates', () => {
    expect(renderInspectResponse(REPORT)).toContain('🔐 requires human approval on every call (§3.7)');
    expect(renderInspectResponse(UNGATED)).not.toContain('requires human approval');
  });

  it('should truncate only the prompt and report the omitted characters', () => {
    const response = renderInspectResponse({ ...REPORT, prompt: 'x'.repeat(20_000) });
    expect(response.length).toBeLessThanOrEqual(16_000);
    expect(response).toContain('- bookmark: save 🔐, list');
    expect(response).toMatch(/… \[truncated, \d+ characters omitted\]$/u);
  });
});
