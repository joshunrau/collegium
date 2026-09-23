import { describe, expect, it } from 'vitest';

import {
  PENDING_LISTING_LIMIT,
  renderNothingWaiting,
  renderParkedOn,
  renderPendingAge,
  renderPendingDecisions
} from '../approvals.utils.ts';

import type { PendingDecisionListing } from '../approvals.utils.ts';

const NOW = new Date('2026-09-17T12:00:00Z');

const BASE = {
  agentUsername: 'mira',
  channelId: 'channel-1',
  channelName: 'Finance Ops',
  promptPostId: 'post-1',
  requestedAt: new Date('2026-09-17T11:43:00Z'),
  turnId: 'turn-1'
};

const approval = (overrides: { promptPostId?: null } = {}): PendingDecisionListing => ({
  ...BASE,
  actionName: 'mail::send',
  kind: 'approval',
  ...overrides
});

const question = (text: string): PendingDecisionListing => ({
  ...BASE,
  actionName: 'ask::human',
  kind: 'ask',
  question: text
});

describe('renderPendingAge', () => {
  it('should render days and hours past a day', () => {
    expect(renderPendingAge(new Date('2026-09-15T08:00:00Z'), NOW)).toBe('2d 4h');
  });

  it('should render minutes under an hour, and say so under a minute', () => {
    expect(renderPendingAge(new Date('2026-09-17T11:43:00Z'), NOW)).toBe('17m');
    expect(renderPendingAge(new Date('2026-09-17T11:59:50Z'), NOW)).toBe('under a minute');
  });
});

describe('renderPendingDecisions', () => {
  it('should name the agent, the action, the age, the channel and the prompt post', () => {
    expect(renderPendingDecisions([approval()], NOW)).toBe(
      '1 approval(s) waiting on a human:\n· @mira · 🔐 `mail::send` · 17m · Finance Ops · prompt `post-1`'
    );
  });

  it('should list a question beside the approvals with the head of its words on one line (§3.7a)', () => {
    const rendered = renderPendingDecisions([approval(), question(`Which\n\nairport? ${'x'.repeat(100)}`)], NOW);
    expect(rendered.split('\n')[0]).toBe('1 approval(s) and 1 question(s) waiting on a human:');
    expect(rendered.split('\n')[2]).toBe(
      `· @mira · ❓ \`ask::human\` "Which airport? ${'x'.repeat(65)}…" · 17m · Finance Ops · prompt \`post-1\``
    );
  });

  it('should say a row whose prompt never posted names no post', () => {
    expect(renderPendingDecisions([approval({ promptPostId: null })], NOW)).toContain('no prompt was posted');
  });

  it('should cap the listing and count the rest', () => {
    const rows = Array.from({ length: PENDING_LISTING_LIMIT + 3 }, () => approval());
    const rendered = renderPendingDecisions(rows, NOW);
    expect(rendered.split('\n')).toHaveLength(PENDING_LISTING_LIMIT + 2);
    expect(rendered).toContain('…and 3 more.');
  });
});

describe('renderParkedOn', () => {
  it('should say what the turn waits on, for how long and since when, and where to answer it (§8.1)', () => {
    expect(renderParkedOn({ decision: question('Which airport?'), since: '11:43 UTC' }, NOW)).toBe(
      '❓ `ask::human` "Which airport?" · for 17m, since 11:43 UTC · prompt `post-1`'
    );
  });
});

describe('renderNothingWaiting', () => {
  it('should distinguish quiet everywhere from quiet where you can see (§8.4)', () => {
    expect(renderNothingWaiting()).toBe('Nothing is waiting on a human in the channels you are in.');
  });
});
