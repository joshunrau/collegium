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

describe('Turn termination', () => {
  const harness = setupHarness(SCENARIO);

  it('ends the turn and posts the error under the agent’s name on a semantic error (§7.1)', async () => {
    const { agents, channels, inference } = harness();
    inference.willReply({ agent: 'mira', contains: 'break' }, toolCallResponse('does_not_exist'));

    await channels.main.mention('mira', 'break please');
    const notice = await channels.main.awaitPost({
      description: 'the semantic error notice under the agent’s name',
      match: (post) => post.authorId === agents.mira.userId && post.text.includes('internal error')
    });

    expect(notice.text).toContain('does_not_exist');
  });

  it('retries a transport error invisibly and posts nothing (§7.2)', async () => {
    const { channels, inference } = harness();
    const reply = `recovered-${randomUUID()}`;
    inference.willFail({ agent: 'mira' }, { status: 503, times: 2 });
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'flaky provider');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    const posts = await channels.main.posts();
    expect(posts.some((post) => post.text.includes('provider'))).toBe(false);
  });

  it('ends the turn and posts the failure under the agent’s name when retries are exhausted (§7.1)', async () => {
    const { agents, channels, inference } = harness();
    inference.willFail({ agent: 'mira' }, { status: 503, times: 3 });

    await channels.main.mention('mira', 'dead provider');
    await channels.main.awaitPost({
      description: 'the provider outage notice under the agent’s name',
      match: (post) => post.authorId === agents.mira.userId && post.text.includes('provider')
    });
  });

  // no tool in this roadmap's inventory can be made to hang from outside the process, so the
  // side-effect-ambiguity row is exercised in tools.executor.test.ts rather than through Mattermost
  it.todo('ends the turn stating completion cannot be confirmed when a mutating call times out (§7.1)');

  it('releases the channel lock however the turn ended, so a fresh post starts a fresh turn (§7.1)', async () => {
    const { channels, inference } = harness();
    const reply = `alive-again-${randomUUID()}`;
    inference.willFail({ agent: 'mira', contains: 'die' }, { status: 503, times: 3 });

    await channels.main.mention('mira', 'die now');
    await channels.main.awaitPost({
      description: 'the provider outage notice',
      match: (post) => post.text.includes('provider')
    });

    inference.willReply({ agent: 'mira', contains: 'alive' }, textResponse(reply));
    await channels.main.mention('mira', 'still alive?');
    await channels.main.awaitReplyFrom('mira', { text: reply });
  });
});

const HALT_SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: ['workspace'],
      username: 'mira'
    },
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Owen. Reply clearly and briefly.',
      tools: [],
      username: 'owen'
    }
  ],
  channels: [{ name: 'main' }],
  // the harness handshake consumes one slot, then three turns fit before the fourth breaches
  hourlyCeiling: 4
});

const CHAIN_SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: [],
      username: 'mira'
    },
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Owen. Reply clearly and briefly.',
      tools: [],
      username: 'owen'
    }
  ],
  channels: [{ name: 'main' }]
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Loop control', () => {
  const harness = setupHarness(CHAIN_SCENARIO);

  // the delegation-limit notice is a fixed string, so each test scopes its chain with a unique
  // phrase and only awaits posts past its own watermark — a stale notice can never match
  const scriptChain = (phrase: string, turns: { mira: number; owen: number }, separator = ' ') => {
    const { agents, inference } = harness();
    inference.willReply(
      { agent: 'mira', contains: phrase },
      textResponse(`@${agents.owen.username}${separator}${phrase}`),
      { times: turns.mira }
    );
    inference.willReply(
      { agent: 'owen', contains: phrase },
      textResponse(`@${agents.mira.username}${separator}${phrase}`),
      { times: turns.owen }
    );
  };

  const requestCounts = () => {
    const { inference } = harness();
    return { mira: inference.requestsFor('mira').length, owen: inference.requestsFor('owen').length };
  };

  const awaitDelegationLimitNotice = () =>
    harness().channels.main.awaitPost({
      description: 'the delegation-limit notice',
      match: (post) => post.text.includes('delegation limit'),
      timeoutMs: 60_000
    });

  const awaitChainSettled = async (phrase: string) => {
    const { agents, channels } = harness();
    await channels.main.awaitPost({
      description: 'the final output with its agent mention stripped',
      match: (post) =>
        post.text === `${agents.owen.username} ${phrase}` || post.text === `${agents.mira.username} ${phrase}`,
      timeoutMs: 60_000
    });
  };

  // depth is never rendered anywhere, so all three cases observe it the same way: the chain length
  // at which the fixed limit trips. 11 turns from a human, 10 from a trigger, is the arithmetic.
  it('starts an agent-initiated turn at one greater than its parent’s depth (§7.4)', async () => {
    const { channels } = harness();
    const phrase = `carry on ${randomUUID()}`;
    const before = requestCounts();
    scriptChain(phrase, { mira: 6, owen: 5 });

    await channels.main.mention('mira', phrase);
    await awaitDelegationLimitNotice();

    const after = requestCounts();
    expect(after.mira - before.mira).toBe(6);
    expect(after.owen - before.owen).toBe(5);
    await awaitChainSettled(phrase);
  });

  it('starts a trigger-initiated turn at depth one (§7.4)', async () => {
    const { agents, app, channels } = harness();
    const phrase = `carry on ${randomUUID()}`;
    const before = requestCounts();
    scriptChain(phrase, { mira: 5, owen: 5 });

    await channels.main.say('setting a fresh watermark');
    const response = await fetch(`${app.url}/triggers`, {
      body: JSON.stringify({
        reference: { subject: phrase },
        targetAgentUsername: agents.mira.username,
        targetChannelId: channels.main.id
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    expect(response.status).toBe(202);
    await awaitDelegationLimitNotice();

    const after = requestCounts();
    expect(after.mira - before.mira).toBe(5);
    expect(after.owen - before.owen).toBe(5);
    await awaitChainSettled(phrase);
  });

  it('refuses agent mentions and posts the delegation-limit notice at depth ten (§7.4)', async () => {
    const { agents, channels } = harness();
    const phrase = `carry on ${randomUUID()}`;
    const before = requestCounts();
    scriptChain(phrase, { mira: 6, owen: 5 });

    await channels.main.mention('mira', phrase);
    const notice = await awaitDelegationLimitNotice();
    expect(notice.authorId).toBe(agents.mira.userId);
    expect(notice.text).toContain('someone needs to pick this up');

    await channels.main.awaitPost({
      description: 'the final output with its agent mention stripped',
      match: (post) => post.authorId === agents.mira.userId && post.text === `${agents.owen.username} ${phrase}`,
      timeoutMs: 60_000
    });
    await sleep(500);
    expect(requestCounts().owen - before.owen).toBe(5);
  });

  // Mattermost ends a mention at punctuation and still notifies, so the framework's own grammar
  // must agree with it (§4.5) or the limit below is enforced against text nobody actually posted
  it('enforces the delegation limit when the mention is followed by a full stop (§7.4)', async () => {
    const { channels } = harness();
    const phrase = `carry on ${randomUUID()}`;
    const before = requestCounts();
    scriptChain(phrase, { mira: 6, owen: 5 }, '. ');

    await channels.main.mention('mira', phrase);
    await awaitDelegationLimitNotice();

    const after = requestCounts();
    expect(after.mira - before.mira).toBe(6);
    expect(after.owen - before.owen).toBe(5);
  });
});

const TRANSIENT_SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: [],
      username: 'mira'
    },
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Owen. Reply clearly and briefly.',
      tools: [],
      username: 'owen'
    }
  ],
  channels: [{ name: 'main' }]
});

describe('Delegation width', () => {
  const harness = setupHarness(TRANSIENT_SCENARIO);

  it('never activates a peer named in transient status text (§4.5)', async () => {
    const { agents, channels, inference } = harness();
    const marker = `transient-${randomUUID()}`;
    const done = `done-${marker}`;
    inference.willReply(
      { agent: 'mira', contains: marker },
      toolCallsResponse([{ arguments: { name: 'handing-work-to-a-peer' }, name: 'skills__load' }], {
        content: `Sure, hello @${agents.owen.username}.`
      })
    );
    inference.willReply({ agent: 'mira' }, textResponse(done));
    const before = inference.requestsFor('owen').length;

    await channels.main.mention('mira', marker);
    await channels.main.awaitReplyFrom('mira', { text: done });
    await sleep(1500);

    expect(inference.requestsFor('owen').length).toBe(before);
  });
});

describe('Global halt', () => {
  const harness = setupHarness(HALT_SCENARIO);

  it('halts every agent at the hourly ceiling: the breach posts prominently, pending prompts are invalidated, and further posts start no turn (§7.4, §8.4)', async () => {
    const { channels, inference, systemBot } = harness();
    const marker = `gated ${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'write something' },
      toolCallResponse('workspace__write', { content: marker, path: 'halted.md' })
    );

    await channels.main.mention('mira', 'write something');
    const prompt = await channels.main.awaitPost({
      description: 'the pending approval prompt',
      match: (post) => post.text.includes('Approval required') && post.text.includes(marker)
    });

    for (const turn of ['turn two', 'turn three']) {
      const reply = `${turn}-${randomUUID()}`;
      inference.willReply({ agent: 'owen', contains: turn }, textResponse(reply));
      await channels.main.mention('owen', turn);
      await channels.main.awaitReplyFrom('owen', { text: reply });
    }

    await channels.main.mention('owen', 'turn four breaches the ceiling');
    await channels.main.awaitPost({
      description: 'the prominent halt post from the system bot',
      match: (post) => post.authorId === systemBot.userId && post.text.includes('Halted')
    });
    await channels.main.awaitPostUpdate(prompt, { contains: 'No longer awaiting a decision' });

    const requestsBeforeSilence = inference.requestsFor('owen').length;
    await channels.main.mention('owen', 'anyone there?');
    await sleep(1500);
    expect(inference.requestsFor('owen').length).toBe(requestsBeforeSilence);
  });
});
