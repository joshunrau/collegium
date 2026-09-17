import { describe, expect, it } from 'vitest';

import {
  renderProviderOutageNotice,
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

  it('should state the elapsed time on the outcome line, in seconds and past the minute (§8.1)', () => {
    expect(renderStatusPost({ elapsedMs: 59_400, outcome: 'completed', traceLines: [] })).toBe('✅ _done (59s)_');
    expect(renderStatusPost({ elapsedMs: 60_000, outcome: 'completed', traceLines: [] })).toBe('✅ _done (1m 0s)_');
    expect(renderStatusPost({ elapsedMs: 200_000, outcome: 'killed', traceLines: [] })).toBe('⏹️ _killed (3m 20s)_');
  });

  it('should omit the elapsed time from a turn whose end was never observed (§7.3)', () => {
    expect(renderStatusPost({ outcome: 'abandoned', traceLines: [] })).toBe(
      '⚪ _abandoned — the process restarted mid-turn_'
    );
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

describe('renderProviderOutageNotice', () => {
  it('should name the transport cause in one fixed phrase, and nothing when none is known', () => {
    expect(renderProviderOutageNotice({ kind: 'transport', reason: 'response_timeout' })).toBe(
      '⚠️ **Error**: Failed to reach the model provider — the provider accepted the request but sent nothing within the inference timeout'
    );
    expect(renderProviderOutageNotice({ kind: 'transport', reason: 'http_status', status: 503 })).toContain('HTTP 503');
    expect(renderProviderOutageNotice({ detail: 'secret words', kind: 'transport', reason: 'unknown' })).toBe(
      '⚠️ **Error**: Failed to reach the model provider'
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

  it('§7.1 — should name the class of refusal for the three statuses the providers document', () => {
    expect(renderProviderRejectionNotice(401)).toBe(
      '⚠️ **Error**: The model provider rejected the request — the API key was refused (HTTP 401)'
    );
    expect(renderProviderRejectionNotice(402)).toBe(
      "⚠️ **Error**: The model provider rejected the request — the account's balance is exhausted (HTTP 402)"
    );
    expect(renderProviderRejectionNotice(403)).toBe(
      '⚠️ **Error**: The model provider rejected the request — forbidden by a permission or moderation rule (HTTP 403)'
    );
  });

  it('§7.1 — should give any other status the number alone', () => {
    expect(renderProviderRejectionNotice(500)).toBe('⚠️ **Error**: The model provider rejected the request (HTTP 500)');
  });
});
