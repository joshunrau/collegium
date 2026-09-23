import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { textResponse } from '../../support/inference.ts';
import { DEFAULT_SCENARIO } from '../../support/scenario.ts';

describe('Pinned posts', () => {
  const harness = setupHarness(DEFAULT_SCENARIO);

  const completeTurn = async (prompt: string) => {
    const { channels, inference } = harness();
    const reply = `reply-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: prompt }, textResponse(reply));
    await channels.main.mention('mira', prompt);
    await channels.main.awaitReplyFrom('mira', { text: reply });
    return inference.requestsFor('mira').at(-1);
  };

  it('carries a post a person pinned after the window, past a reset (§3.8)', async () => {
    const { app, channels } = harness();
    const ruling = `ruling-${randomUUID()}`;
    const post = await channels.main.say(ruling);
    await channels.main.pin(post);
    await app.awaitPinState(post.id, { isPinned: true });
    await channels.main.runCommand(`/collegium reset ${harness().agents.mira.username}`);
    await channels.main.awaitPost({
      description: 'the reset notice',
      match: (notice) => notice.text.includes('Episode boundary set')
    });

    const request = await completeTurn('pin check');
    expect(request?.tail).toContain(`## Pinned in this channel`);
    expect(request?.tail).toContain(`<<<post ${post.id}\n${ruling}\n>>>`);
    expect(request?.systemPrompt).not.toContain(ruling);
  });

  it('follows an edit of a pinned post, and leaves the post out once unpinned (§8.2)', async () => {
    const { app, channels } = harness();
    const original = `original-${randomUUID()}`;
    const revised = `revised-${randomUUID()}`;
    const post = await channels.main.say(original);
    await channels.main.pin(post);
    await app.awaitPinState(post.id, { isPinned: true });
    await channels.main.edit(post, revised);
    await app.awaitPinState(post.id, { isPinned: true, message: revised });

    const edited = await completeTurn('edit check');
    expect(edited?.tail).toContain(revised);
    expect(edited?.tail).not.toContain(original);

    await channels.main.unpin(post);
    await app.awaitPinState(post.id, { isPinned: false });
    const unpinned = await completeTurn('unpin check');
    expect(unpinned?.tail).not.toContain(revised);
  });
});
