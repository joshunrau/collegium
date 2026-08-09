import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { textResponse, toolCallResponse } from '../../support/inference.ts';
import { defineScenario } from '../../support/scenario.ts';

const SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: ['resolve_trigger', 'write_file'],
      username: 'mira'
    },
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Owen. Reply clearly and briefly.',
      tools: [],
      username: 'owen'
    }
  ],
  channels: [{ name: 'main' }, { members: ['mira'], name: 'mira-only' }]
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Trigger delivery', () => {
  const harness = setupHarness(SCENARIO);

  const intake = async (subject: string) => {
    const { agents, app, channels } = harness();
    const response = await fetch(`${app.url}/triggers`, {
      body: JSON.stringify({
        reference: { subject },
        targetAgentUsername: agents.mira.username,
        targetChannelId: channels.main.id
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    expect(response.status).toBe(202);
    return (await response.json()) as { id: string };
  };

  it('posts a trigger from the system bot mentioning the target agent and starts a normal turn (§4.2)', async () => {
    const { agents, channels, inference, systemBot } = harness();
    const subject = `invoice overdue ${randomUUID()}`;
    const reply = `handled-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: subject }, textResponse(reply));

    await intake(subject);
    const announcement = await channels.main.awaitPost({
      description: 'the trigger announcement from the system bot',
      match: (post) => post.authorId === systemBot.userId && post.text.includes(subject)
    });
    expect(announcement.text).toContain(`@${agents.mira.username}`);
    await channels.main.awaitReplyFrom('mira', { text: reply });
  });

  it('posts a trigger exactly once (§4.2)', async () => {
    const { channels, inference } = harness();
    const subject = `one-shot ${randomUUID()}`;
    const reply = `once-${randomUUID()}`;
    const followUp = `after-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: subject }, textResponse(reply));

    await intake(subject);
    await channels.main.awaitReplyFrom('mira', { text: reply });

    inference.willReply({ agent: 'mira', contains: 'unrelated' }, textResponse(followUp));
    await channels.main.mention('mira', 'unrelated question');
    await channels.main.awaitReplyFrom('mira', { text: followUp });

    const posts = await channels.main.posts();
    expect(posts.filter((post) => post.text.includes(subject))).toHaveLength(0);
  });
});

describe('Idle gating', () => {
  const harness = setupHarness(SCENARIO);

  const intake = async (subject: string) => {
    const { agents, app, channels } = harness();
    await fetch(`${app.url}/triggers`, {
      body: JSON.stringify({
        reference: { subject },
        targetAgentUsername: agents.mira.username,
        targetChannelId: channels.main.id
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
  };

  it('holds a trigger while a turn is running and posts it once the channel goes idle (§4.2)', async () => {
    const { channels, inference, systemBot } = harness();
    const subject = `held-work ${randomUUID()}`;
    const busyReply = `busy-done-${randomUUID()}`;
    const triggerReply = `trigger-done-${randomUUID()}`;
    const blocked = inference.willBlock({ agent: 'mira', contains: 'stay busy' }, textResponse(busyReply));

    await channels.main.mention('mira', 'stay busy');
    await blocked.arrived;
    await intake(subject);
    await sleep(1500);
    const whileBusy = await channels.main.posts();
    expect(whileBusy.some((post) => post.text.includes(subject))).toBe(false);

    inference.willReply({ agent: 'mira', contains: subject }, textResponse(triggerReply));
    blocked.release();
    await channels.main.awaitReplyFrom('mira', { text: busyReply });
    const announcement = await channels.main.awaitPost({
      description: 'the held trigger posted once idle',
      match: (post) => post.authorId === systemBot.userId && post.text.includes(subject)
    });
    expect(announcement.text).toContain(subject);
    await channels.main.awaitReplyFrom('mira', { text: triggerReply });
  });

  it('holds a trigger while an approval is pending in the target channel (§4.2)', async () => {
    const { channels, inference, systemBot } = harness();
    const subject = `held-behind-approval ${randomUUID()}`;
    const marker = `gated content ${randomUUID()}`;
    const reply = `approved-then-trigger-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'write with permission' },
      toolCallResponse('write_file', { content: marker, path: 'held.md' })
    );

    await channels.main.mention('mira', 'write with permission');
    const prompt = await channels.main.awaitPost({
      description: 'the pending approval prompt',
      match: (post) => post.text.includes('Approval required') && post.text.includes(marker)
    });
    await intake(subject);
    await sleep(1000);
    expect((await channels.main.posts()).some((post) => post.text.includes(subject))).toBe(false);

    inference.willReply({ agent: 'mira' }, textResponse(reply));
    await channels.main.clickAction(prompt, 'approve');
    await channels.main.awaitReplyFrom('mira', { text: reply });
    await channels.main.awaitPost({
      description: 'the trigger announcement after the approval resolved',
      match: (post) => post.authorId === systemBot.userId && post.text.includes(subject)
    });
  });
});

describe('Trigger lifecycle', () => {
  const harness = setupHarness(SCENARIO);

  const intake = async (subject: string) => {
    const { agents, app, channels } = harness();
    const response = await fetch(`${app.url}/triggers`, {
      body: JSON.stringify({
        reference: { subject },
        targetAgentUsername: agents.mira.username,
        targetChannelId: channels.main.id
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    return (await response.json()) as { id: string };
  };

  it('stops re-posting a trigger the agent has marked handled (§4.2)', async () => {
    const { channels, inference, systemBot } = harness();
    const subject = `resolvable ${randomUUID()}`;
    const reply = `resolved-${randomUUID()}`;
    const later = `later-${randomUUID()}`;

    const { id } = await intake(subject);
    inference.willReply({ agent: 'mira', contains: subject }, toolCallResponse('resolve_trigger', { id }));
    inference.willReply({ agent: 'mira' }, textResponse(reply));
    await channels.main.awaitReplyFrom('mira', { text: reply });

    inference.willReply({ agent: 'mira', contains: 'anything else' }, textResponse(later));
    await channels.main.mention('mira', 'anything else?');
    await channels.main.awaitReplyFrom('mira', { text: later });

    const posts = await channels.main.posts();
    expect(posts.filter((post) => post.authorId === systemBot.userId && post.text.includes(subject))).toHaveLength(0);
  });

  it('refuses intake for a channel the target agent is not in (§4.2)', async () => {
    const { agents, app, channels } = harness();
    const response = await fetch(`${app.url}/triggers`, {
      body: JSON.stringify({
        reference: { subject: `unroutable ${randomUUID()}` },
        targetAgentUsername: agents.owen.username,
        targetChannelId: channels['mira-only'].id
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ kind: 'agent-absent' });
  });

  it('keeps an unhandled trigger outstanding across a restart (§7.3)', async () => {
    const { app, channels, inference, systemBot } = harness();
    const subject = `survives-restart ${randomUUID()}`;
    const reply = `post-restart-${randomUUID()}`;
    const blocked = inference.willBlock({ agent: 'mira', contains: 'freeze' }, textResponse('never-lands'));

    await channels.main.mention('mira', 'freeze please');
    await blocked.arrived;
    await intake(subject);
    await sleep(500);
    expect((await channels.main.posts()).some((post) => post.text.includes(subject))).toBe(false);

    inference.willReply({ agent: 'mira', contains: subject }, textResponse(reply));
    await app.restart();
    await channels.main.awaitPost({
      description: 'the surviving trigger announced after the restart sweep',
      match: (post) => post.authorId === systemBot.userId && post.text.includes(subject),
      timeoutMs: 20_000
    });
    await channels.main.awaitReplyFrom('mira', { text: reply });
  });
});
