import { describe, expect, it } from 'vitest';

import { renderTriggerPost } from '../triggers.renderer.ts';

import type { Trigger } from '../triggers.types.ts';

const MAX_POST_SIZE = 300;

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

const HEADER_OF = {
  cron: '🔔 Scheduled → @mira\n\n⟨trigger-1⟩ fired. Its text is the operator’s instruction: carry it out, then mark it done with `triggers__resolve("trigger-1")`.',
  mail: '🔔 New Mail → @mira\n\n⟨trigger-1⟩ arrived. Read it and say here what it needs, then mark it done with `triggers__resolve("trigger-1")`.',
  webhook:
    '🔔 Webhook → @mira\n\n⟨trigger-1⟩ arrived. Read it and say here what it needs, then mark it done with `triggers__resolve("trigger-1")`.'
} as const;

describe('renderTriggerPost', () => {
  it('should mention the agent, report a webhook’s arrival without instructing, and label the sender’s reference (§4.2)', () => {
    const rendered = renderTriggerPost(
      trigger({ id: 'msg-7', sender: 'billing@acme.com', subject: 'invoice overdue' }),
      MAX_POST_SIZE
    );
    expect(rendered.message).toBe(`${HEADER_OF.webhook}\n\ninvoice overdue · from billing@acme.com · sender ref msg-7`);
    expect(rendered.files).toStrictEqual([]);
  });

  it('should bracket the framework’s id and nothing else (§4.2)', () => {
    const { message } = renderTriggerPost(trigger({ id: 'trig_01kq', subject: 'invoice overdue' }), MAX_POST_SIZE);
    expect(message.match(/⟨[^⟩]*⟩/gu)).toStrictEqual(['⟨trigger-1⟩']);
  });

  it('should stop at the header when the reference carries nothing', () => {
    expect(renderTriggerPost(trigger({}), MAX_POST_SIZE).message).toBe(HEADER_OF.webhook);
  });

  it('should keep the summary above a webhook body, since nothing puts sender or subject inside it', () => {
    const rendered = renderTriggerPost(
      trigger({ body: 'Order 88 shipped.', sender: 'shop@acme.com', subject: 'Shipment' }),
      MAX_POST_SIZE
    );
    expect(rendered.message).toBe(`${HEADER_OF.webhook}\n\nShipment · from shop@acme.com\n\nOrder 88 shipped.`);
  });

  it('should report a mail’s arrival without instructing, naming its ref but not repeating the summary its body carries (§4.2)', () => {
    const rendered = renderTriggerPost(
      trigger(
        { body: 'Please pay invoice 42.', id: '1:12', sender: 'billing@acme.com', subject: 'Invoice overdue' },
        'mail'
      ),
      MAX_POST_SIZE
    );
    expect(rendered.message).toBe(`${HEADER_OF.mail}\n\nmail ref 1:12\n\nPlease pay invoice 42.`);
    expect(rendered.files).toStrictEqual([]);
  });

  it('should give a schedule’s prompt as the operator’s instruction to carry out, naming the schedule (§4.2)', () => {
    const rendered = renderTriggerPost(
      trigger({ body: 'Sweep the shared mailbox.', id: 'morning-sweep', subject: 'morning-sweep' }, 'cron'),
      MAX_POST_SIZE
    );
    expect(rendered.message).toBe(`${HEADER_OF.cron}\n\nschedule morning-sweep\n\nSweep the shared mailbox.`);
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
