import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { textResponse, toolCallResponse } from '../../support/inference.ts';
import { defineScenario } from '../../support/scenario.ts';

import type { Channel } from '../../support/channel.ts';

const SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: ['memory', 'workspace'],
      username: 'mira'
    }
  ],
  channels: [{ name: 'main' }, { name: 'side' }, { members: ['mira'], name: 'dm', type: 'direct' }]
});

const DIALOG_TITLE = 'Clear this channel';

describe('/collegium clear (§8.5)', () => {
  const harness = setupHarness(SCENARIO);

  /** runs the command, confirms it, and waits for the notice to report the outcome */
  const clear = async (channel: Channel<'mira'>, flag = ''): Promise<Channel.Post> => {
    channel.forgetInteractions();
    await channel.runCommand(`/collegium clear ${flag}`.trim());
    const dialog = await channel.awaitDialog({ title: DIALOG_TITLE });
    await channel.submitDialog(dialog, {});
    return channel.awaitPost({
      description: 'the clear notice, revised to its outcome',
      match: (post) => post.text.includes('cleared this channel')
    });
  };

  it('deletes every post and the agents’ record of them, leaving the notice as the boundary', async () => {
    const { channels, inference } = harness();
    const before = `before-clear-${randomUUID()}`;
    const reply = `read-${randomUUID()}`;
    const said = await channels.main.say(`context: ${before}`);
    inference.willReply({ agent: 'mira', contains: 'confirm you read' }, textResponse(reply));
    await channels.main.mention('mira', 'confirm you read');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    const notice = await clear(channels.main);
    const { username } = await channels.main.whoAmI();
    expect(notice.text).toContain(`${username} cleared this channel`);
    expect(notice.text).toContain('the agents start fresh here');
    const remaining = await channels.main.allPosts();
    expect(remaining.map((post) => post.id)).not.toContain(said.id);
    expect(remaining.every((post) => post.createdAt >= notice.createdAt)).toBe(true);

    const later = `later-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'what do you know' }, textResponse(later));
    await channels.main.mention('mira', 'what do you know');
    await channels.main.awaitReplyFrom('mira', { text: later });
    const request = JSON.stringify(inference.requestsFor('mira').at(-1)?.messages);
    expect(request).not.toContain(before);
    expect(request).not.toContain(reply);
    expect(request).toContain('cleared this channel');
  });

  it('refuses while a turn is parked on an approval, naming the agent', async () => {
    const { agents, channels, inference } = harness();
    const marker = `parked content ${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'park here' },
      toolCallResponse('workspace__write', { content: marker, path: 'parked.md' })
    );
    await channels.main.mention('mira', 'park here');
    await channels.main.awaitPost({
      description: 'the approval prompt',
      match: (post) => post.authorId === agents.mira.userId && post.text.includes(marker)
    });

    channels.main.forgetInteractions();
    await channels.main.runCommand('/collegium clear');
    const refusal = await channels.main.awaitEphemeral({
      contains: `A turn is running here (${agents.mira.username})`
    });
    expect(refusal.message).toContain('/collegium kill');

    await channels.main.runCommand('/collegium kill');
    await channels.main.awaitPost({ description: 'the kill notice', match: (post) => post.text.includes('Killed') });
  });

  it('deletes the memories written from turns here with --memories, and keeps the rest', async () => {
    const { agents, channels, inference } = harness();
    const gone = `gone-${randomUUID()}`;
    const kept = `kept-${randomUUID()}`;
    // the turn after a tool call carries the result as its latest input, so its reply is matched by agent alone
    inference.willReply(
      { agent: 'mira', contains: 'remember in main' },
      toolCallResponse('memory__write', { body: gone, description: gone })
    );
    inference.willReply({ agent: 'mira' }, textResponse('noted in main'));
    await channels.main.mention('mira', 'remember in main');
    await channels.main.awaitReplyFrom('mira', { text: 'noted in main' });
    inference.willReply(
      { agent: 'mira', contains: 'remember in side' },
      toolCallResponse('memory__write', { body: kept, description: kept })
    );
    inference.willReply({ agent: 'mira' }, textResponse('noted in side'));
    await channels.side.mention('mira', 'remember in side');
    await channels.side.awaitReplyFrom('mira', { text: 'noted in side' });

    await clear(channels.main, '--memories');
    channels.main.forgetInteractions();
    await channels.main.runCommand(`/collegium memory ${agents.mira.username}`);
    const listing = await channels.main.awaitEphemeral({ contains: kept });
    expect(listing.message).not.toContain(gone);
  });

  it('clears a DM, where the notice is posted under the agent’s own account (§7.5)', async () => {
    const { agents, channels, inference } = harness();
    const secret = `between us ${randomUUID()}`;
    const reply = `dm-reply-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: secret }, textResponse(reply));
    const said = await channels.dm.say(secret);
    await channels.dm.awaitReplyFrom('mira', { text: reply });

    const notice = await clear(channels.dm);
    expect(notice.authorId).toBe(agents.mira.userId);
    const remaining = await channels.dm.allPosts();
    expect(remaining.map((post) => post.id)).not.toContain(said.id);
  });

  it('answers any other argument with the usage line', async () => {
    const { channels } = harness();
    channels.main.forgetInteractions();
    await channels.main.runCommand('/collegium clear --everything');
    await channels.main.awaitEphemeral({ contains: 'Usage: /collegium clear [--memories]' });
  });

  it('boots and backfills from the notice after a clear', async () => {
    const { app, channels, inference } = harness();
    const before = `before-restart-${randomUUID()}`;
    await channels.main.say(before);
    await clear(channels.main);
    await app.restart();

    const later = `after-restart-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'still here' }, textResponse(later));
    await channels.main.mention('mira', 'still here');
    await channels.main.awaitReplyFrom('mira', { text: later });
    expect(JSON.stringify(inference.requestsFor('mira').at(-1)?.messages)).not.toContain(before);
  });
});
