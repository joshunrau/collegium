import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { textResponse } from '../../support/inference.ts';
import { defineScenario } from '../../support/scenario.ts';

const SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      username: 'mira'
    }
  ],
  channels: [
    { name: 'main' },
    { members: ['mira'], name: 'flow', triggerMode: 'respond-to-all' },
    { members: ['mira'], name: 'dm', type: 'direct' }
  ]
});

describe('Triggering mode', () => {
  const harness = setupHarness(SCENARIO);

  it('starts a turn for an unaddressed human post in a respond-to-all channel (§3.10)', async () => {
    const { channels, inference } = harness();
    const reply = `flow-reply-${randomUUID()}`;
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.flow.say('no mention here');
    await channels.flow.awaitReplyFrom('mira', { text: reply });
  });

  it('starts no turn for an unaddressed human post in a mention-required channel (§3.10)', async () => {
    const { channels, inference } = harness();
    inference.forgetRequests();
    const reply = `main-reply-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'sentinel' }, textResponse(reply));

    await channels.main.say('nothing for anyone');
    await channels.main.mention('mira', 'sentinel');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    expect(inference.requestsFor('mira')).toHaveLength(1);
  });

  it('starts a turn for every human post in a direct message (§3.10)', async () => {
    const { channels, inference } = harness();
    const reply = `dm-reply-${randomUUID()}`;
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.dm.say('hey, quick question');
    await channels.dm.awaitReplyFrom('mira', { text: reply });
  });

  it('starts no turn for an agent post in a respond-to-all channel unless mentioned (§3.10)', async () => {
    const { channels, inference } = harness();
    inference.forgetRequests();
    const first = `first-${randomUUID()}`;
    const second = `second-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'one' }, textResponse(first));
    inference.willReply({ agent: 'mira', contains: 'two' }, textResponse(second));

    await channels.flow.say('message one');
    await channels.flow.awaitReplyFrom('mira', { text: first });
    await channels.flow.say('message two');
    await channels.flow.awaitReplyFrom('mira', { text: second });

    expect(inference.requestsFor('mira')).toHaveLength(2);
  });

  it('starts no turn for a system bot post unless mentioned (§3.10)', async () => {
    const { channels, inference, systemBot } = harness();
    inference.forgetRequests();
    const reply = `after-system-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'sentinel' }, textResponse(reply));

    await channels.flow.sayAs(systemBot, 'routine system announcement');
    await channels.flow.say('sentinel');
    await channels.flow.awaitReplyFrom('mira', { text: reply });

    expect(inference.requestsFor('mira')).toHaveLength(1);
  });
});

const MULTI_AGENT_SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      username: 'mira'
    },
    {
      expertise: 'Startup verification',
      systemPrompt: 'You are Owen. Reply clearly and briefly.',
      username: 'owen'
    },
    {
      expertise: 'Scheduling',
      systemPrompt: 'You are Tess. Reply clearly and briefly.',
      username: 'tess'
    }
  ],
  channels: [{ name: 'main' }]
});

describe('Multi-agent mentions', () => {
  const harness = setupHarness(MULTI_AGENT_SCENARIO);

  it('starts no turn and posts one system bot correction when a human post mentions two agents (§4.5)', async () => {
    const { agents, channels, inference } = harness();
    inference.forgetRequests();

    await channels.main.say(`@${agents.mira.username} @${agents.owen.username} split this between you`);
    await channels.main.awaitPostFrom('system', { text: '⚠️ Address one agent per message.' });

    expect(inference.requests()).toHaveLength(0);
  });

  it('queues nothing when a human post mentions two agents (§4.5)', async () => {
    const { agents, channels, inference } = harness();
    inference.forgetRequests();
    const reply = `sentinel-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'sentinel' }, textResponse(reply));

    await channels.main.say(`@${agents.mira.username} @${agents.owen.username} nobody take this`);
    await channels.main.awaitPostFrom('system', { text: '⚠️ Address one agent per message.' });
    await channels.main.mention('mira', 'sentinel');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    expect(inference.requests()).toHaveLength(1);
  });

  it('rejects agent-authored output mentioning two agents and continues the turn (§4.5)', async () => {
    const { agents, channels, inference } = harness();
    inference.forgetRequests();
    const offending = `@${agents.owen.username} and @${agents.tess.username}, split this`;
    const clean = `@${agents.owen.username}, please take this ${randomUUID()}`;
    inference.willReply({ agent: 'mira' }, textResponse(offending));
    inference.willReply({ agent: 'mira' }, textResponse(clean));
    inference.willReply({ agent: 'owen' }, textResponse('on it'));

    await channels.main.mention('mira', 'delegate the work');
    await channels.main.awaitReplyFrom('mira', { text: clean });

    const posts = await channels.main.posts();
    expect(posts.some((post) => post.text === offending)).toBe(false);
    const retry = inference.requestsFor('mira').at(-1);
    expect(retry?.messages.at(-1)).toMatchObject({ content: 'post rejected: multiple agent mentions', role: 'user' });
  });
});
