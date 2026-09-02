import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { QUEUED_ACKNOWLEDGEMENT_EMOJI } from '@/activation/activation.constants.ts';

import { setupHarness } from '../../support/harness.ts';
import { textResponse, toolCallResponse } from '../../support/inference.ts';
import { defineScenario } from '../../support/scenario.ts';

const SCENARIO = defineScenario({
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

const RESUME_SCENARIO = defineScenario({
  ...SCENARIO,
  // the harness handshake spends a slot, so two turns fit before the third breaches
  hourlyCeiling: 3
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const INSPECT_SCENARIO = defineScenario({
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

describe('Ephemeral commands', () => {
  const harness = setupHarness(INSPECT_SCENARIO);

  it('/collegium.trace returns a turn’s full tool trace to the invoker alone (§8.3)', async () => {
    const { channels, inference } = harness();
    const fact = `fact-${randomUUID()}`;
    const reply = `traced-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'remember' },
      toolCallResponse('memory__write', { body: fact, description: 'a test fact' })
    );
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'remember this');
    const finalPost = await channels.main.awaitReplyFrom('mira', { text: reply });
    await channels.main.runCommand(`/collegium.trace ${finalPost.id}`);
    const trace = await channels.main.awaitEphemeral({ contains: 'memory::write' });
    expect(trace.message).toContain(`called \`memory::write\``);
    expect(trace.message).toContain(fact);
    expect((await channels.main.posts()).some((post) => post.text.includes('Trace for turn'))).toBe(false);
  });

  it('/collegium.queue reports pending depth and the oldest unprocessed post (§8.4)', async () => {
    const { agents, channels, inference } = harness();
    const drained = `drained-${randomUUID()}`;
    const blocked = inference.willBlock({ agent: 'mira', contains: 'hold the line' }, textResponse('holding done'));

    await channels.main.mention('mira', 'hold the line');
    await blocked.arrived;
    const queued = await channels.main.mention('mira', `queued ${randomUUID()}`);
    await channels.main.awaitReaction(queued, QUEUED_ACKNOWLEDGEMENT_EMOJI);
    await channels.main.runCommand(`/collegium.queue ${agents.mira.username}`);
    const report = await channels.main.awaitEphemeral({ contains: 'oldest unprocessed' });
    expect(report.message).toContain(queued.id);

    inference.willReply({ agent: 'mira' }, textResponse(drained));
    blocked.release();
    await channels.main.awaitReplyFrom('mira', { text: drained });
  });

  it('/collegium.triggers lists outstanding triggers for an agent (§8.4)', async () => {
    const { agents, app, channels, inference } = harness();
    const subject = `pending-review ${randomUUID()}`;
    const acknowledged = `ack-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: subject }, textResponse(acknowledged));

    const response = await fetch(`${app.url}/triggers`, {
      body: JSON.stringify({
        reference: { subject },
        targetAgentUsername: agents.mira.username,
        targetChannelId: channels.main.id
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const { id } = (await response.json()) as { id: string };
    await channels.main.awaitReplyFrom('mira', { text: acknowledged });

    await channels.main.runCommand(`/collegium.triggers ${agents.mira.username}`);
    const listing = await channels.main.awaitEphemeral({ contains: id });
    expect(listing.message).toContain('posted');
  });
});

describe('Posting commands', () => {
  const harness = setupHarness(INSPECT_SCENARIO);

  it('/collegium.forget removes a post from agent context (§8.4)', async () => {
    const { channels, inference } = harness();
    const secret = `secret-${randomUUID()}`;
    const reply = `clean-${randomUUID()}`;
    const seed = await channels.main.say(`note: ${secret}`);
    await sleep(500);

    await channels.main.runCommand(`/collegium.forget ${seed.id}`);
    await channels.main.awaitPost({
      description: 'the forget acknowledgement',
      match: (post) => post.text.includes('removed from agent context')
    });

    inference.willReply({ agent: 'mira', contains: 'summarize' }, textResponse(reply));
    await channels.main.mention('mira', 'summarize the channel');
    await channels.main.awaitReplyFrom('mira', { text: reply });
    const request = inference.requestsFor('mira').at(-1);
    expect(JSON.stringify(request?.messages)).not.toContain(secret);
  });

  it('/collegium.reset marks an episode boundary that context never reaches past (§3.8)', async () => {
    const { agents, channels, inference } = harness();
    const before = `before-boundary-${randomUUID()}`;
    const reply = `fresh-start-${randomUUID()}`;
    await channels.main.say(`context: ${before}`);
    await sleep(500);

    await channels.main.runCommand(`/collegium.reset ${agents.mira.username}`);
    await channels.main.awaitPost({
      description: 'the reset acknowledgement',
      match: (post) => post.text.includes('Episode boundary set')
    });

    inference.willReply({ agent: 'mira', contains: 'what do you know' }, textResponse(reply));
    await channels.main.mention('mira', 'what do you know');
    await channels.main.awaitReplyFrom('mira', { text: reply });
    const request = inference.requestsFor('mira').at(-1);
    expect(JSON.stringify(request?.messages)).not.toContain(before);
  });
});

describe('/collegium.stop', () => {
  const harness = setupHarness(SCENARIO);

  it('ends current turns in the channel at the next iteration boundary (§7.5)', async () => {
    const { channels, inference } = harness();
    const discarded = `discarded-${randomUUID()}`;
    const blocked = inference.willBlock({ agent: 'mira', contains: 'work forever' }, textResponse(discarded));

    await channels.main.mention('mira', 'work forever');
    await blocked.arrived;
    await channels.main.runCommand('/collegium.stop');
    await channels.main.awaitPost({
      description: 'the stop acknowledgement',
      match: (post) => post.text.includes('Stopping 1 turn')
    });

    blocked.release();
    await sleep(1500);
    expect((await channels.main.posts()).some((post) => post.text.includes(discarded))).toBe(false);
  });
});

describe('/collegium.kill', () => {
  const harness = setupHarness(SCENARIO);

  it('ends current turns in the channel immediately and releases the lock (§7.5)', async () => {
    const { channels, inference } = harness();
    const reply = `fresh-${randomUUID()}`;
    const blocked = inference.willBlock({ agent: 'mira', contains: 'wedge' }, textResponse('never delivered'));

    await channels.main.mention('mira', 'wedge yourself');
    await blocked.arrived;
    await channels.main.runCommand('/collegium.kill');
    await channels.main.awaitPost({
      description: 'the kill acknowledgement',
      match: (post) => post.text.includes('Killed 1 turn')
    });

    inference.willReply({ agent: 'mira', contains: 'again' }, textResponse(reply));
    await channels.main.mention('mira', 'again please');
    await channels.main.awaitReplyFrom('mira', { text: reply });
    blocked.release();
  });
});

describe('/collegium.resume', () => {
  const harness = setupHarness(RESUME_SCENARIO);

  it('clears a global halt, draining the work queued behind it (§7.4)', async () => {
    const { channels, inference, systemBot } = harness();
    const held = `after the ceiling ${randomUUID()}`;
    for (const turn of ['first errand', 'second errand']) {
      const reply = `${turn}-${randomUUID()}`;
      inference.willReply({ agent: 'owen', contains: turn }, textResponse(reply));
      await channels.main.mention('owen', turn);
      await channels.main.awaitReplyFrom('owen', { text: reply });
    }

    await channels.main.mention('owen', held);
    await channels.main.awaitPost({
      description: 'the prominent halt post',
      match: (post) => post.authorId === systemBot.userId && post.text.includes('Halted')
    });

    // the drained turn's latest message is the /resume acknowledgement, so the match is by agent
    const reply = `resumed-${randomUUID()}`;
    inference.willReply({ agent: 'owen' }, textResponse(reply));
    await channels.main.runCommand('/collegium.resume');
    await channels.main.awaitPost({
      description: 'the resume acknowledgement',
      match: (post) => post.text.includes('Resumed')
    });
    await channels.main.awaitReplyFrom('owen', { text: reply });
  });
});

// §7.4's window is per-process, so this needs a harness whose ceiling no earlier test has spent
describe('/collegium.resume and the rolling window', () => {
  const harness = setupHarness(RESUME_SCENARIO);

  it('grants a fresh allowance rather than resuming into the exhausted window (§7.4)', async () => {
    const { channels, inference, systemBot } = harness();
    for (const turn of ['first errand', 'second errand']) {
      const reply = `${turn}-${randomUUID()}`;
      inference.willReply({ agent: 'mira', contains: turn }, textResponse(reply));
      await channels.main.mention('mira', turn);
      await channels.main.awaitReplyFrom('mira', { text: reply });
    }

    // the breaching mention never reaches the model: the halt precedes the turn
    await channels.main.mention('mira', `breach ${randomUUID()}`);
    const halt = await channels.main.awaitPost({
      description: 'the prominent halt post',
      match: (post) => post.authorId === systemBot.userId && post.text.includes('Halted')
    });

    // every turn from here drains behind the halt post, so each matches by agent alone
    const drained = `drained-${randomUUID()}`;
    inference.willReply({ agent: 'mira' }, textResponse(drained));
    await channels.main.runCommand('/collegium.resume');
    await channels.main.awaitReplyFrom('mira', { text: drained });

    // the window was cleared on the human's authority, so a full ceiling's worth runs again
    for (const errand of ['third errand', 'fourth errand']) {
      const reply = `${errand}-${randomUUID()}`;
      inference.willReply({ agent: 'mira' }, textResponse(reply));
      await channels.main.mention('mira', errand);
      await channels.main.awaitReplyFrom('mira', { text: reply });
    }

    const posts = await channels.main.posts();
    expect(posts.filter((post) => post.text.includes('Halted') && post.id !== halt.id)).toHaveLength(0);
  });
});

describe('Intervention scope', () => {
  const harness = setupHarness(SCENARIO);

  it('/collegium.stop and /collegium.kill apply to every agent in the issuing channel (§7.5)', async () => {
    const { channels, inference } = harness();
    const miraDiscarded = `mira-discarded-${randomUUID()}`;
    const owenDiscarded = `owen-discarded-${randomUUID()}`;
    const miraBlocked = inference.willBlock({ agent: 'mira', contains: 'dig in' }, textResponse(miraDiscarded));
    const owenBlocked = inference.willBlock({ agent: 'owen', contains: 'dig in' }, textResponse(owenDiscarded));

    await channels.main.mention('mira', 'dig in');
    await miraBlocked.arrived;
    await channels.main.mention('owen', 'dig in too');
    await owenBlocked.arrived;
    await channels.main.runCommand('/collegium.stop');
    await channels.main.awaitPost({
      description: 'a stop acknowledgement covering both turns',
      match: (post) => post.text.includes('Stopping 2 turn')
    });

    miraBlocked.release();
    owenBlocked.release();
    await sleep(1500);
    const posts = await channels.main.posts();
    expect(posts.some((post) => post.text.includes(miraDiscarded))).toBe(false);
    expect(posts.some((post) => post.text.includes(owenDiscarded))).toBe(false);
  });

  it('/collegium.stop and /collegium.kill leave the queue intact so pending work drains into the next turn (§7.5)', async () => {
    const { channels, inference } = harness();
    const queuedWork = `queued work ${randomUUID()}`;
    const reply = `drained-${randomUUID()}`;
    const blocked = inference.willBlock({ agent: 'mira', contains: 'busy now' }, textResponse('busy output'));

    await channels.main.mention('mira', 'busy now');
    await blocked.arrived;
    const queued = await channels.main.mention('mira', queuedWork);
    await channels.main.awaitReaction(queued, QUEUED_ACKNOWLEDGEMENT_EMOJI);

    // the drained turn's latest message is the /stop acknowledgement, so the match is by agent
    inference.willReply({ agent: 'mira' }, textResponse(reply));
    await channels.main.runCommand('/collegium.stop');
    blocked.release();
    await channels.main.awaitReplyFrom('mira', { text: reply });
  });

  it('accepts /collegium.stop and /collegium.kill from any human in the channel (§7.5)', async () => {
    const { channels, inference } = harness();
    const discarded = `bystander-discarded-${randomUUID()}`;
    const human = await channels.main.joinAsHuman(`human-${randomUUID().slice(0, 8)}`);
    const blocked = inference.willBlock({ agent: 'mira', contains: 'keep working' }, textResponse(discarded));

    await channels.main.mention('mira', 'keep working');
    await blocked.arrived;
    await channels.main.runCommandAs(human, '/collegium.kill');
    await channels.main.awaitPost({
      description: 'the kill acknowledgement issued by a non-admin human',
      match: (post) => post.text.includes('Killed 1 turn')
    });

    blocked.release();
    await sleep(1000);
    expect((await channels.main.posts()).some((post) => post.text.includes(discarded))).toBe(false);
  });
});
