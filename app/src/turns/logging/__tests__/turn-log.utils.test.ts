import { describe, expect, it } from 'vitest';

import { renderTurnClosedLog, renderTurnOpenedLog } from '../turn-log.utils.ts';

describe('renderTurnOpenedLog', () => {
  it('should name what started the turn and the posts a drain began from (§8.3)', () => {
    expect(
      renderTurnOpenedLog({
        activationKind: 'handoff',
        agentUsername: 'mira',
        chainLength: 2,
        channelId: 'channel-1',
        depth: 1,
        drainedFromPostId: 'post-3',
        triggeringPostId: 'post-3',
        turnId: 'turn-1'
      })
    ).toBe(
      'opened turn turn-1 for "mira" in channel-1 by handoff, answering post post-3, draining from post post-3 (depth 1, chain 2)'
    );
  });
});

describe('renderTurnClosedLog', () => {
  it('should name how the turn ended, how long it ran and what it spent', () => {
    expect(
      renderTurnClosedLog({
        actionCount: 4,
        agentUsername: 'mira',
        channelId: 'channel-1',
        elapsedMs: 65_000,
        status: 'completed',
        turnId: 'turn-1',
        usage: { cachedPromptTokens: 900, completionTokens: 40, costUsd: undefined, promptTokens: 1200, reasoningTokens: undefined }
      })
    ).toBe('closed turn turn-1 for "mira" in channel-1 as completed after 1m 5s: 4 actions, 1200 prompt tokens (900 cached), 40 completion');
  });
});
