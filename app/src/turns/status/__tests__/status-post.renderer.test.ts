import { describe, expect, it } from 'vitest';

import {
  renderAbandonedStatusPost,
  renderExtensionPrompt,
  renderProviderOutageNotice,
  renderProviderRejectionNotice,
  renderStatusPost,
  renderSteeringLine,
  renderToolCallLine
} from '../status-post.renderer.ts';

import type { StatusPostState } from '../status-post.renderer.ts';

const state = (over: Partial<StatusPostState> & { lines?: string[] } = {}): StatusPostState => {
  const { lines = [], ...rest } = over;
  return { traceLines: lines.map((text) => ({ kind: 'note' as const, text })), ...rest };
};

const WRITE_CALL = { detail: 'report.txt', effect: '(9 bytes)', kind: 'call' as const, toolName: 'workspace::write' };

const DENIED = { ran: false, text: '🛑 denied by @casey' };

describe('renderSteeringLine', () => {
  it('should name the human who steered the turn (§7.5)', () => {
    expect(renderSteeringLine('casey')).toBe('↩ _steered by @casey_');
  });
});

describe('renderStatusPost', () => {
  it('should stand alone as a working line before anything is traced', () => {
    expect(renderStatusPost(state())).toBe('⏳ _working…_');
  });

  it('should accumulate the trace under the working line and keep the transient text last', () => {
    expect(
      renderStatusPost(state({ lines: ['→ `load_skill`', '→ `write_memory`'], transientText: 'saving what I learned' }))
    ).toBe('⏳ _working…_\n→ `load_skill`\n→ `write_memory`\n_saving what I learned_');
  });

  it('should replace the working line with the outcome and drop the transient text (§8.1)', () => {
    expect(
      renderStatusPost(state({ lines: ['→ `load_skill`'], outcome: 'completed', transientText: 'still here' }))
    ).toBe(`✅ _done_\n→ \`load_skill\``);
  });

  it('should state the elapsed time on the outcome line, in seconds and past the minute (§8.1)', () => {
    expect(renderStatusPost(state({ elapsedMs: 59_400, outcome: 'completed' }))).toBe(`✅ _done (59s)_`);
    expect(renderStatusPost(state({ elapsedMs: 60_000, outcome: 'completed' }))).toBe(`✅ _done (1m 0s)_`);
    expect(renderStatusPost(state({ elapsedMs: 200_000, outcome: 'killed' }))).toBe(`⏹️ _killed (3m 20s)_`);
  });

  it('should name who issued the command that ended the turn (§7.5)', () => {
    expect(renderStatusPost(state({ abortedBy: 'casey', elapsedMs: 17_000, outcome: 'stopped' }))).toBe(
      '⏹️ _stopped by @casey (17s)_'
    );
    expect(renderStatusPost(state({ abortedBy: 'casey', outcome: 'killed' }))).toBe('⏹️ _killed by @casey_');
  });

  it('should omit an empty transient line', () => {
    expect(renderStatusPost(state({ transientText: '' }))).toBe('⏳ _working…_');
  });

  it('should collapse a run of identical call lines into one with a count (§8.1)', () => {
    const click = '→ `web::click ⟨e93⟩`';
    expect(renderStatusPost(state({ lines: [click, click, click, '→ `web::fetch https://x.example/`', click] }))).toBe(
      `⏳ _working…_\n${click} ×3\n→ \`web::fetch https://x.example/\`\n${click}`
    );
  });

  it('should keep a marked line apart from the run it would otherwise join (§8.1)', () => {
    const call = { detail: 'report.txt', kind: 'call' as const, toolName: 'workspace::write' };
    const traceLines = [call, { ...call, mark: DENIED }, call];
    const write = '→ `workspace::write report.txt`';
    expect(renderStatusPost(state({ traceLines }))).toBe(
      `⏳ _working…_\n${write}\n${write} 🛑 denied by @casey\n${write}`
    );
  });

  it('should drop the effect detail from a line the gate denied (§8.1)', () => {
    const traceLines = [WRITE_CALL, { ...WRITE_CALL, mark: DENIED }];
    expect(renderStatusPost(state({ traceLines }))).toBe(
      '⏳ _working…_\n→ `workspace::write report.txt (9 bytes)`\n→ `workspace::write report.txt` 🛑 denied by @casey'
    );
  });

  it('should keep the outcome line when the trace exceeds the post limit (§8.1)', () => {
    const lines = Array.from({ length: 60 }, (_, index) => `→ \`web::fetch https://x.example/page-${index}\``);
    const text = renderStatusPost(state({ lines, outcome: 'completed' }), 400);
    expect(text.length).toBeLessThanOrEqual(400);
    expect(text.startsWith('✅ _done_\n_… ')).toBe(true);
    expect(text).toMatch(/_… \d+ earlier calls; the full trace is in \/collegium trace_/u);
    expect(text).toContain('page-59`');
    expect(text.endsWith('page-59`')).toBe(true);
  });

  it('should drop the transient text before the outcome line when nothing else fits (§8.1)', () => {
    const text = renderStatusPost(
      state({ lines: ['→ `web::fetch https://x.example/`'], transientText: 'x'.repeat(500) }),
      100
    );
    expect(text).toBe('⏳ _working…_\n_… 1 earlier call; the full trace is in /collegium trace_');
  });
});

describe('renderAbandonedStatusPost', () => {
  it('should replace only the working line (§7.3)', () => {
    expect(renderAbandonedStatusPost('⏳ _working…_\n→ `load_skill`\n_still reading_')).toBe(
      '⚪ _abandoned — the process restarted mid-turn_\n→ `load_skill`\n_still reading_'
    );
  });
});

describe('renderExtensionPrompt', () => {
  it('should name the calls repeated most and the agent’s last words beneath the count (§5.3)', () => {
    expect(
      renderExtensionPrompt({
        attemptsSoFar: 200,
        extensionNumber: 1,
        grant: 200,
        lastWords: 'the site keeps reshuffling',
        topCalls: [
          { count: 48, line: '`web::fetch https://x.example/page-2`' },
          { count: 47, line: '`web::fetch https://x.example/page-3`' }
        ]
      })
    ).toBe(
      [
        'I have used all my action attempts and would like to keep going. This would be extension 1; 200 attempts so far. Approving grants another 200.',
        'Most repeated so far: `web::fetch https://x.example/page-2` ×48; `web::fetch https://x.example/page-3` ×47',
        'What I still need: "the site keeps reshuffling"'
      ].join('\n')
    );
  });

  it('should say the agent has written nothing when it has not (§5.3)', () => {
    expect(
      renderExtensionPrompt({ attemptsSoFar: 10, extensionNumber: 2, grant: 10, lastWords: undefined, topCalls: [] })
    ).toBe(
      'I have used all my action attempts and would like to keep going. This would be extension 2; 10 attempts so far. Approving grants another 10.\nI have written nothing since I started.'
    );
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
