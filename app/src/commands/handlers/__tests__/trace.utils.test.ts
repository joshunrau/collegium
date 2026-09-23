import { describe, expect, it } from 'vitest';

import type { ModelRow } from '@/prisma/prisma.types.ts';
import type { Turn } from '@/turns/turns.types.ts';

import { renderTrace } from '../trace.utils.ts';

import type { ParkedDecision } from '../approvals.utils.ts';

const TURN: Turn = {
  actionCount: 2,
  activationKind: 'addressed',
  agentUsername: 'mira',
  cachedPromptTokens: 9_000,
  chainLength: 1,
  channelId: 'channel-1',
  completionTokens: 400,
  contextAssembledAt: new Date('2026-01-01T00:00:01.000Z'),
  costUsd: 0.0123,
  depth: 0,
  drainedFromPostId: null,
  endedAt: new Date('2026-01-01T00:01:05.000Z'),
  id: 'turn-1',
  modelName: 'deepseek-v4-flash',
  promptTokens: 12_000,
  reasoningTokens: 150,
  rootPostId: 'post-9',
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  status: 'completed',
  statusPostId: 'post-10',
  triggeringPostId: 'post-9',
  windowEstimatedTokens: 3_200,
  windowOldestAt: new Date('2025-12-31T23:00:00.000Z')
};

const NOW = new Date('2026-01-01T00:05:00.000Z');

const RECORD = [
  'Started: 2026-01-01T00:00:00.000Z, by addressed (a post addressing it while it was idle), answering post `post-9`.',
  'Ran: 1m 5s, 2 actions.',
  'Context: assembled at +1s, a window of about 3,200 tokens reaching back to 2025-12-31T23:00:00.000Z.',
  'Usage: 12,000 prompt tokens (9,000 cached), 400 completion (150 reasoning); cost $0.0123.'
];

const event = (payload: PrismaJson.TurnEventPayload, at = '2026-01-01T00:00:00.000Z'): ModelRow<'TurnEvent'> => ({
  createdAt: new Date(at),
  id: 'event-1',
  kind: payload.kind,
  payload,
  sequence: 1,
  turnId: 'turn-1'
});

const render = (
  events: ModelRow<'TurnEvent'>[],
  { parked = [], turn = TURN }: { parked?: ParkedDecision[]; turn?: Turn } = {}
): string => {
  return renderTrace({ events, formatDate: (date) => date.toISOString(), now: NOW, parked, turn });
};

describe('renderTrace', () => {
  it('should report a turn that recorded nothing by its row, so a failed turn still reads', () => {
    expect(render([], { turn: { ...TURN, status: 'provider_outage' } })).toBe(
      [
        'Turn turn-1 (mira on deepseek-v4-flash, provider_outage, depth 0, chain 1) recorded no events: no tool call, approval, or record.',
        ...RECORD
      ].join('\n')
    );
  });

  it('should head the events with the turn’s record and number each with its offset from the start (§8.3)', () => {
    const text = render([
      event({ approvalId: 'a1', kind: 'approval_requested', payloadText: 'write a.md', toolName: ['workspace', 'write'] }),
      event(
        { approvalId: 'a1', byUsername: 'casey', decision: 'approved', kind: 'approval_decided' },
        '2026-01-01T00:01:02.000Z'
      )
    ]);
    expect(text).toBe(
      [
        'Trace for turn turn-1 (mira on deepseek-v4-flash, completed, depth 0, chain 1):',
        ...RECORD,
        '1. [+0s] approval requested for `workspace::write`: write a.md',
        '2. [+1m 2s] approval a1 → approved by casey'
      ].join('\n')
    );
  });

  it('should say what drained into the turn and how long a running one has run, without a count it lacks (§8.3)', () => {
    const text = render([], {
      turn: {
        ...TURN,
        activationKind: 'handoff',
        drainedFromPostId: 'post-3',
        endedAt: null,
        status: 'running',
        windowOldestAt: null
      }
    });
    expect(text).toContain(
      'Started: 2026-01-01T00:00:00.000Z, by handoff (a colleague’s turn that addressed it ending or parking), answering post `post-9`, drained from post `post-3`.'
    );
    expect(text).toContain('Running: 5m 0s so far.');
    expect(text).toContain('Context: assembled at +1s, an empty window.');
  });

  it('should say a turn no provider priced reported no usage', () => {
    expect(render([], { turn: { ...TURN, completionTokens: null, promptTokens: null } })).toContain(
      'Usage: none reported.'
    );
  });

  it('should say beneath the record what a running turn waits on a person for (§8.1)', () => {
    const decision = {
      actionName: 'workspace::write',
      agentUsername: 'mira',
      channelId: 'channel-1',
      kind: 'approval',
      promptPostId: 'prompt-1',
      requestedAt: new Date('2026-01-01T00:00:00.000Z'),
      turnId: 'turn-1'
    } as const;
    const text = render(
      [event({ approvalId: 'a1', kind: 'approval_requested', payloadText: 'write a.md', toolName: ['workspace', 'write'] })],
      { parked: [{ decision, since: 'January 1, 2026 at 12:00:00 AM UTC' }], turn: { ...TURN, endedAt: null, status: 'running' } }
    );
    expect(text.split('\n')[5]).toBe(
      'Waiting on a person: 🔐 `workspace::write` · for 5m, since January 1, 2026 at 12:00:00 AM UTC · prompt `prompt-1`'
    );
  });

  it('should show the head of argument text that never parsed beside its result (§7.2)', () => {
    const text = render([
      event({
        callId: 'c1',
        kind: 'tool_result',
        output: 'the arguments to this call were not valid JSON, so the call did not run',
        rawArgumentsPreview: '{"path": "a.txt", "content": "unterminated',
        toolName: ['workspace', 'write']
      })
    ]);
    expect(text).toContain(
      '1. [+0s] `workspace::write` → the arguments to this call were not valid JSON, so the call did not run (arguments as sent: {"path": "a.txt", "content": "unterminated)'
    );
  });

  it('should mark a result as its status-post line does, and say how the model read one it did not read whole (§3.8, §8.1)', () => {
    const text = render([
      event({
        callId: 'c1',
        kind: 'tool_result',
        output: 'the body is over its cap',
        toolName: ['memory', 'append'],
        traceMark: { ran: false, text: '⚠️ refused by the tool' }
      }),
      event({
        callId: 'c2',
        kind: 'tool_result',
        output: 'a long page',
        presentedAs: { collapsed: true, cutToChars: 12_000 },
        toolName: ['web', 'fetch']
      })
    ]);
    expect(text).toContain('1. [+0s] `memory::append` ⚠️ refused by the tool → the body is over its cap');
    expect(text).toContain(
      '2. [+0s] `web::fetch` (the model read its first 12,000 characters, then only its line) → a long page'
    );
  });

  it('should keep a rejected output and the reason it was refused (§4.5)', () => {
    const text = render([
      event({ content: '@owen and @tess', kind: 'output_rejected', reason: 'post rejected: multiple agent mentions' })
    ]);
    expect(text).toContain('1. [+0s] rejected output (post rejected: multiple agent mentions): @owen and @tess');
  });

  it('should append the reason to a decision that carries one', () => {
    const text = render([
      event({
        approvalId: 'a1',
        byUsername: 'casey',
        decision: 'denied_with_reason',
        kind: 'approval_decided',
        reason: 'wrong path'
      })
    ]);
    expect(text).toContain('1. [+0s] approval a1 → denied_with_reason by casey: wrong path');
  });

  it('should render a written record with its description and body', () => {
    const text = render([
      event({
        body: 'ships on Fridays',
        description: 'release cadence',
        kind: 'record_written',
        reference: 'm1',
        supersededDescriptions: []
      })
    ]);
    expect(text).toContain('1. [+0s] record m1 written: release cadence — ships on Fridays');
  });

  it('should name the memories a write evicted (§3.6, §8.1)', () => {
    const text = render([
      event({
        body: 'ships on Fridays',
        description: 'release cadence',
        kind: 'record_written',
        reference: 'm1',
        supersededDescriptions: ['an ancient note', 'a stale plan']
      })
    ]);
    expect(text).toContain(
      '1. [+0s] record m1 written, removing "an ancient note", "a stale plan": release cadence — ships on Fridays'
    );
  });

  it('should name a revision’s count, the passages it replaced and the description it replaced (§3.6)', () => {
    const text = render([
      event({
        body: 'ships on Mondays',
        description: 'release cadence',
        kind: 'record_written',
        reference: 'm1',
        revision: { count: 3, replacedDescription: 'paused cadence', replacedPassages: ['Fridays'] },
        supersededDescriptions: []
      })
    ]);
    expect(text).toContain(
      '1. [+0s] record m1 revised (revision 3), replacing "Fridays", the description "paused cadence": release cadence — ships on Mondays'
    );
  });

  it('should leave the reasoning behind a completion out of the trace (§3.12)', () => {
    const text = render([
      event({ content: 'done', kind: 'assistant_message', reasoningContent: 'private thoughts', toolCalls: [] })
    ]);
    expect(text).toContain('1. [+0s] assistant: done');
    expect(text).not.toContain('private thoughts');
  });

  it('should render a steer with its author (§7.5)', () => {
    expect(render([event({ byUsername: 'casey', kind: 'steering_received', text: 'use staging' })])).toContain(
      '1. [+0s] steered by casey: use staging'
    );
  });

  it('should render a raw name for a call that resolved to no tool', () => {
    const text = render([
      event({
        content: '',
        kind: 'assistant_message',
        toolCalls: [{ args: {}, callId: 'c1', toolName: 'does_not_exist' }]
      })
    ]);
    expect(text).toContain('1. [+0s] called `does_not_exist` with {}');
  });
});
