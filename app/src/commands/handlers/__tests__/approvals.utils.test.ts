import { describe, expect, it } from 'vitest';

import {
  PENDING_LISTING_LIMIT,
  renderApprovalAge,
  renderNothingWaiting,
  renderPendingApprovals
} from '../approvals.utils.ts';

import type { PendingApprovalListing } from '../approvals.utils.ts';

const NOW = new Date('2026-09-17T12:00:00Z');

const row = (overrides: Partial<PendingApprovalListing> = {}): PendingApprovalListing => ({
  actionName: 'mail::send',
  agentUsername: 'mira',
  channelId: 'channel-1',
  channelName: 'Finance Ops',
  promptPostId: 'post-1',
  requestedAt: new Date('2026-09-17T11:43:00Z'),
  ...overrides
});

describe('renderApprovalAge', () => {
  it('should render days and hours past a day', () => {
    expect(renderApprovalAge(new Date('2026-09-15T08:00:00Z'), NOW)).toBe('2d 4h');
  });

  it('should render minutes under an hour, and say so under a minute', () => {
    expect(renderApprovalAge(new Date('2026-09-17T11:43:00Z'), NOW)).toBe('17m');
    expect(renderApprovalAge(new Date('2026-09-17T11:59:50Z'), NOW)).toBe('under a minute');
  });
});

describe('renderPendingApprovals', () => {
  it('should name the agent, the action, the age, the channel and the prompt post', () => {
    expect(renderPendingApprovals([row()], NOW)).toBe(
      '1 approval(s) waiting on a human:\n· @mira · `mail::send` · 17m · Finance Ops · prompt `post-1`'
    );
  });

  it('should say a row whose prompt never posted names no post', () => {
    expect(renderPendingApprovals([row({ promptPostId: null })], NOW)).toContain('no prompt was posted');
  });

  it('should cap the listing and count the rest', () => {
    const rows = Array.from({ length: PENDING_LISTING_LIMIT + 3 }, () => row());
    const rendered = renderPendingApprovals(rows, NOW);
    expect(rendered.split('\n')).toHaveLength(PENDING_LISTING_LIMIT + 2);
    expect(rendered).toContain('…and 3 more.');
  });
});

describe('renderNothingWaiting', () => {
  it('should distinguish quiet everywhere from quiet where you can see (§8.4)', () => {
    expect(renderNothingWaiting()).toBe('Nothing is waiting on a human in the channels you are in.');
  });
});
