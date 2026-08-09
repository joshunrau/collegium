import { describe, expect, it } from 'vitest';

import {
  renderMemoryEvictionLine,
  renderMemoryWriteLine,
  renderProviderRejectionNotice,
  renderStatusPost,
  renderToolCallLine
} from '../status-post.renderer.ts';

describe('renderStatusPost', () => {
  it('should stand alone as a working line before anything is traced', () => {
    expect(renderStatusPost({ traceLines: [] })).toBe('⏳ _working…_');
  });

  it('should accumulate the trace under the working line and keep the transient text last', () => {
    expect(
      renderStatusPost({ traceLines: ['→ `load_skill`', '→ `write_memory`'], transientText: 'saving what I learned' })
    ).toBe('⏳ _working…_\n→ `load_skill`\n→ `write_memory`\n_saving what I learned_');
  });

  it('should replace the working line with the outcome and drop the transient text', () => {
    expect(
      renderStatusPost({ outcome: 'completed', traceLines: ['→ `load_skill`'], transientText: 'still here' })
    ).toBe('✅ _done_\n→ `load_skill`');
  });

  it('should omit an empty transient line', () => {
    expect(renderStatusPost({ traceLines: [], transientText: '' })).toBe('⏳ _working…_');
  });
});

describe('renderToolCallLine', () => {
  it('should show the tool’s summary of the call beside its name', () => {
    expect(renderToolCallLine('browser', 'navigate https://northmoor.example/people/')).toBe(
      '→ `browser navigate https://northmoor.example/people/`'
    );
  });

  it('should name the tool alone when the call has no summary', () => {
    expect(renderToolCallLine('shell')).toBe('→ `shell`');
    expect(renderToolCallLine('shell', '')).toBe('→ `shell`');
  });

  it('should keep the line to one line and out of the code span’s way', () => {
    expect(renderToolCallLine('shell', 'cd /srv\nls -la `pwd`')).toBe('→ `shell cd /srv ls -la pwd`');
  });

  it('should elide a summary past the trace limit', () => {
    expect(renderToolCallLine('shell', 'x'.repeat(151))).toBe(`→ \`shell ${'x'.repeat(150)}…\``);
  });
});

describe('renderMemoryWriteLine', () => {
  it('should disclose the description and body of a memory write', () => {
    expect(renderMemoryWriteLine({ body: 'bullet points, never prose', description: 'casey on formatting' })).toBe(
      '📝 _saved memory: casey on formatting — bullet points, never prose_'
    );
  });

  it('should elide a body past the disclosure limit', () => {
    expect(renderMemoryWriteLine({ body: 'x'.repeat(121), description: 'a long one' })).toBe(
      `📝 _saved memory: a long one — ${'x'.repeat(120)}…_`
    );
  });
});

describe('renderMemoryEvictionLine', () => {
  it('should name the entry the write displaced', () => {
    expect(renderMemoryEvictionLine('casey on formatting')).toBe(
      '♻️ _evicted the oldest memory to make room: casey on formatting_'
    );
  });
});

describe('renderProviderRejectionNotice', () => {
  it('should name the status code, and say a rejection is not an outage', () => {
    expect(renderProviderRejectionNotice(400)).toContain('(HTTP 400)');
  });

  it('should omit the code when the provider gave none', () => {
    expect(renderProviderRejectionNotice(undefined)).not.toContain('HTTP');
  });
});
