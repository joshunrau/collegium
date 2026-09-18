import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { E2E_TRIGGER_TOKEN } from '../../support/env.ts';
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

  it('answers a call naming no granted tool with the tools the agent holds and continues the turn (§7.2)', async () => {
    const { channels, inference } = harness();
    const reply = `renamed-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'misname' }, toolCallResponse('does_not_exist'));
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'misname a tool please');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    const fedBack = inference
      .requestsFor('mira')
      .at(-1)!
      .messages.findLast((message) => message.role === 'tool');
    expect(fedBack?.content).toContain('no tool named "does_not_exist"');
    expect(fedBack?.content).toContain('memory__write');
  });

  it('forgives one tool call whose arguments never parsed and continues the turn (§7.2)', async () => {
    const { channels, inference } = harness();
    const reply = `recovered-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'garbled' },
      toolCallsResponse([{ arguments: {}, name: 'memory__write', rawArguments: '{"content": "unterminated' }])
    );
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'garbled call please');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    const followUp = inference.requestsFor('mira').at(-1)!;
    const fedBack = followUp.messages.findLast((message) => message.role === 'tool');
    expect(fedBack).toMatchObject({
      content: 'the arguments to this call were not valid JSON, so the call did not run'
    });
    expect(JSON.stringify(followUp.messages)).not.toContain('unterminated');
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
  // past the depth limit: a two-agent exchange is all returns, so only the chain length can stop it
  chainLengthLimit: 15,
  channels: [{ name: 'main' }]
});

const DEPTH_SCENARIO = defineScenario({
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
    },
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Omar. Reply clearly and briefly.',
      tools: [],
      username: 'omar'
    }
  ],
  channels: [{ name: 'main' }]
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Loop control: chain length', () => {
  const harness = setupHarness(CHAIN_SCENARIO);

  // the chain-limit notice is a fixed string, so each test scopes its chain with a unique phrase
  // and only awaits posts past its own watermark — a stale notice can never match
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

  const awaitChainLimitNotice = () => {
    return harness().channels.main.awaitPost({
      description: 'the chain-length notice',
      match: (post) => post.text.includes('this chain has reached its limit'),
      timeoutMs: 90_000
    });
  };

  const awaitChainSettled = async (phrase: string) => {
    const { agents, channels } = harness();
    await channels.main.awaitPost({
      description: 'the final output with its agent mention stripped',
      match: (post) => {
        return post.text === `${agents.owen.username} ${phrase}` || post.text === `${agents.mira.username} ${phrase}`;
      },
      timeoutMs: 90_000
    });
  };

  // neither counter is rendered anywhere, so every case observes it the same way: the number of
  // turns that ran before the fixed limit tripped. Fifteen from a human is the arithmetic — and
  // fifteen is past the depth limit of ten, which is the proof that a reply to one's delegator
  // returns rather than nests (§7.4).
  it('returns a mention to the depth of the turn it answers, so a two-agent exchange outlives the depth limit (§7.4)', async () => {
    const { channels } = harness();
    const phrase = `carry on ${randomUUID()}`;
    const before = requestCounts();
    scriptChain(phrase, { mira: 8, owen: 7 });

    await channels.main.mention('mira', phrase);
    await awaitChainLimitNotice();

    const after = requestCounts();
    expect(after.mira - before.mira).toBe(8);
    expect(after.owen - before.owen).toBe(7);
    await awaitChainSettled(phrase);
  });

  it('starts a trigger-initiated chain at one, as a human post does (§7.4)', async () => {
    const { agents, app, channels } = harness();
    const phrase = `carry on ${randomUUID()}`;
    const before = requestCounts();
    scriptChain(phrase, { mira: 8, owen: 7 });

    await channels.main.say('setting a fresh watermark');
    const response = await fetch(`${app.url}/triggers`, {
      body: JSON.stringify({
        reference: { subject: phrase },
        targetAgentUsername: agents.mira.username,
        targetChannelId: channels.main.id
      }),
      headers: { authorization: `Bearer ${E2E_TRIGGER_TOKEN}`, 'content-type': 'application/json' },
      method: 'POST'
    });
    expect(response.status).toBe(202);
    await awaitChainLimitNotice();

    const after = requestCounts();
    expect(after.mira - before.mira).toBe(8);
    expect(after.owen - before.owen).toBe(7);
    await awaitChainSettled(phrase);
  });

  it('refuses agent mentions and posts the chain-length notice at the limit (§7.4)', async () => {
    const { agents, channels } = harness();
    const phrase = `carry on ${randomUUID()}`;
    const before = requestCounts();
    scriptChain(phrase, { mira: 8, owen: 7 });

    await channels.main.mention('mira', phrase);
    const notice = await awaitChainLimitNotice();
    expect(notice.authorId).toBe(agents.mira.userId);
    expect(notice.text).toContain('someone needs to say whether to go on');

    await channels.main.awaitPost({
      description: 'the final output with its agent mention stripped',
      match: (post) => post.authorId === agents.mira.userId && post.text === `${agents.owen.username} ${phrase}`,
      timeoutMs: 90_000
    });
    await sleep(500);
    expect(requestCounts().owen - before.owen).toBe(7);
  });

  // Mattermost ends a mention at punctuation and still notifies, so the framework's own grammar
  // must agree with it (§4.5) or the limit below is enforced against text nobody actually posted
  it('enforces the chain limit when the mention is followed by a full stop (§7.4)', async () => {
    const { channels } = harness();
    const phrase = `carry on ${randomUUID()}`;
    const before = requestCounts();
    scriptChain(phrase, { mira: 8, owen: 7 }, '. ');

    await channels.main.mention('mira', phrase);
    await awaitChainLimitNotice();

    const after = requestCounts();
    expect(after.mira - before.mira).toBe(8);
    expect(after.owen - before.owen).toBe(7);
  });
});

describe('Loop control: delegation depth', () => {
  const harness = setupHarness(DEPTH_SCENARIO);

  // any two-agent alternation is a return, so only a cycle through a third agent hands work down
  // at every hop: mira → owen → omar → mira … climbs one level per turn and trips at depth ten,
  // on the eleventh turn, which is owen's
  it('nests a hand-off to a colleague other than the one who asked, and refuses at depth ten (§7.4)', async () => {
    const { agents, channels, inference } = harness();
    const phrase = `hand down ${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: phrase }, textResponse(`@${agents.owen.username} ${phrase}`), {
      times: 4
    });
    inference.willReply({ agent: 'owen', contains: phrase }, textResponse(`@${agents.omar.username} ${phrase}`), {
      times: 4
    });
    inference.willReply({ agent: 'omar', contains: phrase }, textResponse(`@${agents.mira.username} ${phrase}`), {
      times: 3
    });

    await channels.main.mention('mira', phrase);
    const notice = await channels.main.awaitPost({
      description: 'the delegation-limit notice',
      match: (post) => post.text.includes('delegation limit'),
      timeoutMs: 90_000
    });
    expect(notice.authorId).toBe(agents.owen.userId);
    expect(notice.text).toContain('someone needs to pick this up');

    await channels.main.awaitPost({
      description: 'the final output with its agent mention stripped',
      match: (post) => post.authorId === agents.owen.userId && post.text === `${agents.omar.username} ${phrase}`,
      timeoutMs: 90_000
    });
    await sleep(500);
    expect(inference.requestsFor('mira')).toHaveLength(4);
    expect(inference.requestsFor('owen')).toHaveLength(4);
    expect(inference.requestsFor('omar')).toHaveLength(3);
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
