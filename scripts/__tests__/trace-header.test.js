// @ts-check

import { describe, expect, it } from 'vitest';

import { readTraceHeader } from '../trace-header.js';

const HEAD = [
  'Trace for turn turn-1 (mira on deepseek-v4-flash, completed, depth 0, chain 1):',
  '',
  'Started: September 23, 2026 at 3:53:12 PM EDT, by addressed (a post addressing it while it was idle), answering post `post-9`.',
  'Ran: 1m 5s, 2 actions.',
  'Usage: 2,400 prompt tokens (1,600 cached), 80 completion (20 reasoning); cost $0.0024.',
  ''
];

describe('readTraceHeader', () => {
  it('should read the start as an instant, whatever zone the operator formats it in', () => {
    expect(readTraceHeader(HEAD.join('\n'))?.startedAt).toBe('2026-09-23T19:53:12.000Z');
    const paris = HEAD.join('\n').replace('3:53:12 PM EDT', '9:53:12 PM GMT+2');
    expect(readTraceHeader(paris)?.startedAt).toBe('2026-09-23T19:53:12.000Z');
  });

  it('should leave the start unset where its date does not parse', () => {
    const header = readTraceHeader(HEAD.join('\n').replace('September 23, 2026 at 3:53:12 PM EDT', 'yesterday'));
    expect(header?.startedAt).toBeUndefined();
    expect(header?.activation).toBe('addressed');
  });

  it('should read each completion’s figures off its event line, an estimate marked as one (§8.3)', () => {
    const trace = [
      ...HEAD,
      '1. [+2s] called `workspace::read` with {"path":"a.md"} ⟦completion: 1,200 prompt (800 cached), 40 out (10 reasoning), $0.0012, via Novita⟧',
      '2. [+3s] `workspace::read` → whole',
      '3. [+9s] steered by casey: stop ⟦completion: about 500 out (200 reasoning), estimated⟧',
      '4. [+14s] assistant: done ⟦completion: 1,200 prompt (800 cached), 40 out (10 reasoning), $0.0012, via DeepInfra, after relief⟧'
    ].join('\n');
    expect(readTraceHeader(trace)?.completions).toEqual([
      {
        cachedPromptTokens: 800,
        completionTokens: 40,
        costUsd: 0.0012,
        promptTokens: 1_200,
        reasoningTokens: 10,
        servedBy: 'Novita'
      },
      { completionTokens: 500, estimated: true, reasoningTokens: 200 },
      {
        afterRelief: true,
        cachedPromptTokens: 800,
        completionTokens: 40,
        costUsd: 0.0012,
        promptTokens: 1_200,
        reasoningTokens: 10,
        servedBy: 'DeepInfra'
      }
    ]);
  });

  it('should keep the turn totals apart from the completions, which a trace from before them lacks', () => {
    const header = readTraceHeader(HEAD.join('\n'));
    expect(header?.completions).toBeUndefined();
    expect(header).toMatchObject({
      cachedPromptTokens: 1_600,
      completionTokens: 80,
      costUsd: 0.0024,
      promptTokens: 2_400
    });
  });
});
