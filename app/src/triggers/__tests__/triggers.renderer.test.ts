import { describe, expect, it } from 'vitest';

import { renderTriggerPost } from '../triggers.renderer.ts';

import type { Trigger } from '../triggers.types.ts';

const MAX_POST_SIZE = 200;

const trigger = (reference: PrismaJson.TriggerReference, source: Trigger['source'] = 'webhook'): Trigger => ({
  createdAt: new Date(0),
  dedupeKey: null,
  id: 'trigger-1',
  postedAt: null,
  postId: null,
  reference,
  resolvedAt: null,
  source,
  status: 'pending',
  targetAgentUsername: 'mira',
  targetChannelId: 'channel-1'
});

describe('renderTriggerPost', () => {
  it('should mention the agent and summarize every reference field it carries', () => {
    const rendered = renderTriggerPost(
      trigger({ id: 'msg-7', sender: 'billing@acme.com', subject: 'invoice overdue' }),
      MAX_POST_SIZE
    );
    expect(rendered.message).toBe(
      '🔔 @mira — webhook: invoice overdue · from billing@acme.com · ref msg-7. Handle it, then mark it done with triggers__resolve("trigger-1").'
    );
    expect(rendered.files).toStrictEqual([]);
  });

  it('should omit the reference fields the event did not carry', () => {
    expect(renderTriggerPost(trigger({ subject: 'invoice overdue' }), MAX_POST_SIZE).message).toContain(
      'webhook: invoice overdue. Handle it'
    );
  });

  it('should fall back to a fixed phrase when the reference carries nothing', () => {
    expect(renderTriggerPost(trigger({}), MAX_POST_SIZE).message).toContain('webhook: a new event. Handle it');
  });

  it('should carry a mail body inline while it fits the post limit', () => {
    const rendered = renderTriggerPost(
      trigger({ body: 'Please pay invoice 42.', sender: 'billing@acme.com', subject: 'Invoice overdue' }, 'mail'),
      MAX_POST_SIZE
    );
    expect(rendered.message).toContain('Please pay invoice 42.');
    expect(rendered.files).toStrictEqual([]);
  });

  it('should attach a body too large to post, saying so in place of the text', () => {
    const body = 'x'.repeat(MAX_POST_SIZE);
    const rendered = renderTriggerPost(trigger({ body, subject: 'Invoice overdue' }, 'mail'), MAX_POST_SIZE);
    expect(rendered.message).not.toContain(body);
    expect(rendered.message).toContain('too large to post');
    expect(rendered.message).toContain('message.md');
    expect(rendered.files).toStrictEqual([{ content: body, filename: 'message.md' }]);
  });
});
