import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { textResponse, toolCallResponse, toolCallsResponse } from '../../support/inference.ts';
import { defineScenario } from '../../support/scenario.ts';

const SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: ['memory'],
      username: 'mira'
    }
  ],
  channels: [{ name: 'main' }]
});

describe('Status post', () => {
  const harness = setupHarness(SCENARIO);

  it('posts exactly one status post per turn (§8.1)', async () => {
    const { channels, inference } = harness();
    const reply = `done-${randomUUID()}`;
    inference.willReply({ agent: 'mira' }, toolCallResponse('skills__load', { name: 'handing-work-to-a-peer' }));
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'use your skill');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    const posts = await channels.main.posts();
    expect(posts.filter((post) => post.text.includes('→'))).toHaveLength(1);
  });

  it('appends each tool call to the same status post rather than posting again (§8.1)', async () => {
    const { agents, channels, inference } = harness();
    const reply = `appended-${randomUUID()}`;
    inference.willReply({ agent: 'mira' }, toolCallResponse('skills__load', { name: 'handing-work-to-a-peer' }));
    inference.willReply({ agent: 'mira' }, toolCallResponse('memory__read', { id: 'no-such-memory' }));
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'two tools please');
    const statusPost = await channels.main.awaitPost({
      description: 'the status post carrying the first tool call',
      match: (post) =>
        post.authorId === agents.mira.userId && post.text.includes('→ `skills::load handing-work-to-a-peer`')
    });
    const updated = statusPost.text.includes('→ `memory::read no-such-memory`')
      ? statusPost
      : await channels.main.awaitPostUpdate(statusPost, { contains: '→ `memory::read no-such-memory`' });

    expect(updated.id).toBe(statusPost.id);
    expect(updated.text).toContain('→ `skills::load handing-work-to-a-peer`');
    await channels.main.awaitReplyFrom('mira', { text: reply });
  });

  it('emits a disclosure line showing description and body for every memory write (§3.6)', async () => {
    const { agents, channels, inference } = harness();
    const description = `casey likes brevity ${randomUUID()}`;
    const reply = `remembered-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'remember that' },
      toolCallResponse('memory__write', { body: 'short answers, always', description })
    );
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'remember that');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    await channels.main.awaitPost({
      description: 'the memory disclosure line in the status post',
      match: (post) =>
        post.authorId === agents.mira.userId &&
        post.text.includes(`recorded: ${description}`) &&
        post.text.includes('short answers, always')
    });
  });
});

describe('Turn output', () => {
  const harness = setupHarness(SCENARIO);

  it('treats text emitted alongside a tool call as transient status, not a reply (§3.3)', async () => {
    const { channels, inference } = harness();
    const transient = `let me check my notes ${randomUUID()}`;
    const reply = `checked-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira' },
      toolCallsResponse([{ arguments: { name: 'handing-work-to-a-peer' }, name: 'skills__load' }], {
        content: transient
      })
    );
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'think out loud');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    const posts = await channels.main.posts();
    expect(posts.some((post) => post.text === transient)).toBe(false);
  });

  it('terminates the turn on text emitted with no tool call (§3.3)', async () => {
    const { channels, inference } = harness();
    inference.forgetRequests();
    const reply = `terminal-${randomUUID()}`;
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'just answer');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    expect(inference.requestsFor('mira')).toHaveLength(1);
  });

  it('does not count framework posting against the action budget (§3.3)', async () => {
    const { channels, inference } = harness();
    const reply = `under-budget-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira' },
      toolCallsResponse(
        Array.from({ length: 10 }, (_, index) => ({
          arguments: { body: `body ${index}`, description: `note ${index}` },
          name: 'memory__write'
        }))
      )
    );
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'spend the whole budget');
    await channels.main.awaitReplyFrom('mira', { text: reply });
  });
});
