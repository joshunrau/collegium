import { describe, expect, it } from 'vitest';

import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';

import { renderInspectResponse } from '../inspect.utils.ts';

import type { InspectReport } from '../inspect.utils.ts';

/** what `preventWrappingAtHyphens` inserts, so an expectation reads as the name an operator sees */
const JOINER = '⁠';

const REPORT: InspectReport = {
  profile: buildAgentProfile(),
  prompt: 'You are Mira.',
  schedules: [{ channel: 'ops', handle: 'morning-sweep', nextOccurrence: 'September 18, 2026 at 9:00:00 AM UTC' }],
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
  it('should head the report with the agent and its settings', () => {
    expect(renderInspectResponse(REPORT)).toContain(
      ['### @mira', '', '#### Profile', '', '| Setting | Value |'].join('\n')
    );
    expect(renderInspectResponse(REPORT)).toContain('| **Context Budget** | 8,000 tokens |');
  });

  it('should state the turn ceiling with the view it implies, and the completion time limit (§8.4)', () => {
    const report = renderInspectResponse(REPORT);
    expect(report).toContain(
      "| **Turn Ceiling** | 27,200 tokens; a result over 16,320 characters, or over its tool's narrower view, is shown in part |"
    );
    expect(report).toContain('| **Completion Time Limit** | 20 minutes |');
  });

  it('should table tools by namespace, marking a gated tool beside its ungated neighbours (§3.4)', () => {
    expect(renderInspectResponse(REPORT)).toContain(
      [
        '| Toolset | Tools |',
        '| --- | --- |',
        '| **`clock`** | `now` |',
        '| **`bookmark`** | `save`\\*, `list` |'
      ].join('\n')
    );
  });

  it('should show the gate legend only when a listed tool gates', () => {
    expect(renderInspectResponse(REPORT)).toContain('_\\* Requires human approval on every call (§3.7)._');
    expect(renderInspectResponse(UNGATED)).not.toContain('Requires human approval');
  });

  it('should source each skill, holding its name on one line', () => {
    expect(renderInspectResponse(REPORT)).toContain(
      `| **\`framework\`** | \`handing-${JOINER}work-${JOINER}to-${JOINER}a-${JOINER}peer\` | How to hand work over. |`
    );
    expect(renderInspectResponse(REPORT)).toContain(
      `| **\`bookmark\`** | \`saving-${JOINER}bookmarks\` | How to bookmark. |`
    );
  });

  it('should list each schedule with when it next fires (§8.4)', () => {
    expect(renderInspectResponse(REPORT)).toContain(
      `| **\`morning-${JOINER}sweep\`** | ~ops | September 18, 2026 at 9:00:00 AM UTC |`
    );
  });

  it('should leave out a section the agent has nothing in', () => {
    const bare = renderInspectResponse({ ...REPORT, schedules: [], skills: [], tools: [] });
    expect(bare).not.toContain('#### Schedules');
    expect(bare).not.toContain('#### Skills');
    expect(bare).not.toContain('#### Tools');
    expect(bare).toContain('#### Profile');
  });

  it('should quote the prompt so it renders as the Markdown it is, blank lines included', () => {
    const response = renderInspectResponse({ ...REPORT, prompt: '## How you work\n\nBegin when asked.' });
    expect(response).toContain(
      ['#### Prompt in This Channel', '', '> ## How you work', '>', '> Begin when asked.'].join('\n')
    );
  });

  it('should cut the prompt at a line boundary and report what it omitted', () => {
    const prompt = Array.from({ length: 400 }, (_, line) => `line ${line} ${'x'.repeat(80)}`).join('\n');
    const response = renderInspectResponse({ ...REPORT, prompt });
    expect(response.length).toBeLessThanOrEqual(16_000);
    expect(response).toContain('| **`bookmark`** | `save`\\*, `list` |');
    expect(response).toMatch(/\n> line \d+ x+\n\n_… truncated — [\d,]+ of [\d,]+ characters omitted\._$/u);
  });
});
