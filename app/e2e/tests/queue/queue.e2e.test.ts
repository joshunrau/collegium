import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { QUEUED_ACKNOWLEDGEMENT_EMOJI } from '@/activation/activation.constants.ts';

import { setupHarness } from '../../support/harness.ts';
import { failureResponse, textResponse, toolCallResponse } from '../../support/inference.ts';
import { defineScenario } from '../../support/scenario.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: ['workspace'],
      username: 'mira'
    }
  ],
  channels: [{ name: 'main' }, { name: 'side' }]
});

describe('Queue', () => {
  const harness = setupHarness(SCENARIO);

  it('acknowledges a post addressed to a busy agent with a 👀 reaction and posts no reply (§5.2)', async () => {
    const { agents, channels, inference } = harness();
    const longReply = `long-done-${randomUUID()}`;
    const drainReply = `drain-done-${randomUUID()}`;
    const blocked = inference.willBlock({ agent: 'mira', contains: 'long task' }, textResponse(longReply));

    await channels.main.mention('mira', 'long task');
    await blocked.arrived;
    const queued = await channels.main.mention('mira', 'while you are busy');
    await channels.main.awaitReaction(queued, QUEUED_ACKNOWLEDGEMENT_EMOJI);

    const whileQueued = await channels.main.posts();
    expect(whileQueued.filter((post) => post.authorId === agents.mira.userId)).toHaveLength(0);

    inference.willReply({ agent: 'mira' }, textResponse(drainReply));
    blocked.release();
    await channels.main.awaitReplyFrom('mira', { text: longReply });
    await channels.main.awaitReplyFrom('mira', { text: drainReply });
  });

  it('drains every queued post into a single new turn once the channel goes idle (§5.2)', async () => {
    const { channels, inference } = harness();
    inference.forgetRequests();
    const longReply = `slow-done-${randomUUID()}`;
    const drainReply = `caught-up-${randomUUID()}`;
    const fragments = [`frag-one-${randomUUID()}`, `frag-two-${randomUUID()}`, `frag-three-${randomUUID()}`];
    const blocked = inference.willBlock({ agent: 'mira', contains: 'slow work' }, textResponse(longReply));

    await channels.main.mention('mira', 'slow work');
    await blocked.arrived;
    for (const fragment of fragments) {
      const queued = await channels.main.mention('mira', fragment);
      await channels.main.awaitReaction(queued, QUEUED_ACKNOWLEDGEMENT_EMOJI);
    }

    inference.willReply({ agent: 'mira' }, textResponse(drainReply));
    blocked.release();
    await channels.main.awaitReplyFrom('mira', { text: drainReply });

    expect(inference.requestsFor('mira')).toHaveLength(2);
    const drainRequest = inference.requestsFor('mira').at(-1);
    for (const fragment of fragments) {
      expect(drainRequest?.messages.some((message) => message.content?.includes(fragment))).toBe(true);
    }
  });

  it('queues nothing posted by the system bot (§5.2)', async () => {
    const { agents, channels, inference, systemBot } = harness();
    inference.forgetRequests();
    const longReply = `busy-done-${randomUUID()}`;
    const sentinelReply = `sentinel-done-${randomUUID()}`;
    const blocked = inference.willBlock({ agent: 'mira', contains: 'occupy yourself' }, textResponse(longReply));

    await channels.main.mention('mira', 'occupy yourself');
    await blocked.arrived;
    await channels.main.sayAs(systemBot, `@${agents.mira.username} system announcement`);
    blocked.release();
    await channels.main.awaitReplyFrom('mira', { text: longReply });

    inference.willReply({ agent: 'mira', contains: 'sentinel' }, textResponse(sentinelReply));
    await channels.main.mention('mira', 'sentinel');
    await channels.main.awaitReplyFrom('mira', { text: sentinelReply });

    expect(inference.requestsFor('mira')).toHaveLength(2);
  });
});

describe('Standing queue', () => {
  const harness = setupHarness(SCENARIO);

  it('answers the next post exactly once when a queue entry was left standing (§5.2, §7.1)', async () => {
    const { channels, inference } = harness();
    const blocked = inference.willBlock({ agent: 'mira', contains: 'hold here' }, failureResponse(503));

    await channels.main.mention('mira', 'hold here');
    await blocked.arrived;
    const queued = await channels.main.mention('mira', `queued while busy ${randomUUID()}`);
    await channels.main.awaitReaction(queued, QUEUED_ACKNOWLEDGEMENT_EMOJI);

    // a provider outage cannot make progress, so §7.1 leaves the queue standing
    inference.willFail({ agent: 'mira' }, { status: 503, times: 2 });
    blocked.release();
    await channels.main.awaitPost({
      description: 'the provider outage notice',
      match: (post) => post.text.includes('provider')
    });

    // scripted twice so a duplicate turn fails on the count below rather than on an unscripted 503
    const reply = `answered-once-${randomUUID()}`;
    inference.willReply({ agent: 'mira' }, textResponse(reply), { times: 2 });
    const before = inference.requestsFor('mira').length;
    await channels.main.mention('mira', 'and now answer');
    await channels.main.awaitReplyFrom('mira', { text: reply });
    await sleep(2000);

    expect(inference.requestsFor('mira').length - before).toBe(1);
  });
});

describe('Channel concurrency', () => {
  const harness = setupHarness(SCENARIO);

  it('runs one turn at a time for an agent within a channel (§5.1)', async () => {
    const { channels, inference } = harness();
    inference.forgetRequests();
    const firstReply = `first-done-${randomUUID()}`;
    const drainReply = `second-done-${randomUUID()}`;
    const blocked = inference.willBlock({ agent: 'mira', contains: 'first job' }, textResponse(firstReply));

    await channels.main.mention('mira', 'first job');
    await blocked.arrived;
    const second = await channels.main.mention('mira', 'second job');
    await channels.main.awaitReaction(second, QUEUED_ACKNOWLEDGEMENT_EMOJI);
    expect(inference.requestsFor('mira')).toHaveLength(1);

    inference.willReply({ agent: 'mira' }, textResponse(drainReply));
    blocked.release();
    await channels.main.awaitReplyFrom('mira', { text: drainReply });
  });

  it('runs a turn in another channel while one channel is busy (§5.1)', async () => {
    const { channels, inference } = harness();
    const mainReply = `main-done-${randomUUID()}`;
    const sideReply = `side-done-${randomUUID()}`;
    const blocked = inference.willBlock({ agent: 'mira', contains: 'hold main' }, textResponse(mainReply));

    await channels.main.mention('mira', 'hold main');
    await blocked.arrived;
    inference.willReply({ agent: 'mira', contains: 'side question' }, textResponse(sideReply));
    await channels.side.mention('mira', 'side question');
    await channels.side.awaitReplyFrom('mira', { text: sideReply });

    blocked.release();
    await channels.main.awaitReplyFrom('mira', { text: mainReply });
  });

  it('keeps at most one live approval prompt per agent per channel (§5.1)', async () => {
    const { channels, inference } = harness();
    const marker = `single-prompt-${randomUUID()}`;
    const firstReply = `first-approved-${randomUUID()}`;
    const drainReply = `drained-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'gated work' },
      toolCallResponse('workspace__write', { content: marker, path: 'single.md' })
    );

    await channels.main.mention('mira', 'gated work');
    const prompt = await channels.main.awaitPost({
      description: 'the approval prompt',
      match: (post) => post.text.includes('Approval required') && post.text.includes(marker)
    });
    const queued = await channels.main.mention('mira', 'more gated work please');
    await channels.main.awaitReaction(queued, QUEUED_ACKNOWLEDGEMENT_EMOJI);

    // the queued mention advanced the watermark past the live prompt, so any prompt visible here
    // would be a second one — and there must be none
    const sinceQueued = await channels.main.posts();
    expect(sinceQueued.filter((post) => post.text.includes('Approval required'))).toHaveLength(0);

    inference.willReply({ agent: 'mira' }, textResponse(firstReply));
    inference.willReply({ agent: 'mira' }, textResponse(drainReply));
    await channels.main.clickAction(prompt, 'approve');
    await channels.main.awaitReplyFrom('mira', { text: firstReply });
    await channels.main.awaitReplyFrom('mira', { text: drainReply });
  });
});
