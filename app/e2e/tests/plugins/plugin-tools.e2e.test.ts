import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { textResponse, toolCallResponse } from '../../support/inference.ts';
import { defineScenario } from '../../support/scenario.ts';

const SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      skills: ['bookmark::saving-bookmarks'],
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: ['bookmark'],
      toolSettings: { bookmark: { maxBookmarks: 5 } },
      username: 'mira'
    }
  ],
  channels: [{ name: 'main' }],
  plugins: ['bookmark']
});

describe('Plugin capability', () => {
  const harness = setupHarness(SCENARIO);

  it('gates a plugin tool behind approval and round-trips its storage across turns', async () => {
    const { channels, inference } = harness();
    const id = `bm-${randomUUID().slice(0, 8)}`;
    const url = 'https://example.com/spec';

    inference.willReply({ agent: 'mira', contains: 'save this' }, toolCallResponse('bookmark__save', { id, url }));
    await channels.main.mention('mira', `save this as ${id}`);
    const prompt = await channels.main.awaitPost({
      description: `the approval prompt for saving "${id}"`,
      match: (post) => post.text.includes('Approval required') && post.text.includes(url)
    });

    const saved = `saved-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: `bookmark ${id} saved` }, textResponse(saved));
    await channels.main.clickAction(prompt, 'approve');
    await channels.main.awaitReplyFrom('mira', { text: saved });

    const listed = `listed-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'list them' }, toolCallResponse('bookmark__list', {}));
    inference.willReply({ agent: 'mira', contains: '1/5 bookmarks' }, textResponse(listed));
    await channels.main.mention('mira', 'list them');
    await channels.main.awaitReplyFrom('mira', { text: listed });
  });

  it('serves a plugin skill through skills::load under its qualified name', async () => {
    const { channels, inference } = harness();
    const reply = `skill-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'consult your skill' },
      toolCallResponse('skills__load', { name: 'bookmark::saving-bookmarks' })
    );
    inference.willReply({ agent: 'mira', contains: 'Saving bookmarks' }, textResponse(reply));

    await channels.main.mention('mira', 'consult your skill');
    await channels.main.awaitReplyFrom('mira', { text: reply });
  });

  it('does not prompt for the ungated list tool', async () => {
    const { channels, inference } = harness();
    const reply = `ungated-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'anything saved' }, toolCallResponse('bookmark__list', {}));
    inference.willReply({ agent: 'mira', contains: 'bookmarks' }, textResponse(reply));

    await channels.main.mention('mira', 'anything saved?');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    const posts = await channels.main.posts();
    expect(posts.some((post) => post.text.includes('Approval required'))).toBe(false);
  });
});
