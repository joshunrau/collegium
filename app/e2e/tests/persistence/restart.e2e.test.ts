import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { QUEUED_ACKNOWLEDGEMENT_EMOJI } from '@/activation/activation.constants.ts';

import { setupHarness } from '../../support/harness.ts';
import { textResponse, toolCallResponse } from '../../support/inference.ts';
import { DEFAULT_SCENARIO, defineScenario } from '../../support/scenario.ts';

const SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: ['workspace'],
      username: 'mira'
    },
    {
      expertise: 'Research and information gathering',
      systemPrompt: 'You are Owen. Reply clearly and briefly.',
      username: 'owen'
    }
  ],
  channels: [{ name: 'main' }, { members: ['owen'], name: 'private-side' }]
});

describe('Restart', () => {
  const harness = setupHarness(SCENARIO);

  it('abandons in-flight turns, invalidates pending prompts, and posts one boot notice (§7.3)', async () => {
    const { app, channels, inference } = harness();
    const marker = `doomed content ${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'start something' },
      toolCallResponse('workspace__write', { content: marker, path: 'doomed.md' })
    );

    await channels.main.mention('mira', 'start something');
    const prompt = await channels.main.awaitPost({
      description: 'the approval prompt',
      match: (post) => post.text.includes('Approval required') && post.text.includes(marker)
    });

    await app.restart();

    const invalidated = await channels.main.awaitPostUpdate(prompt, { contains: 'No longer awaiting a decision' });
    expect(invalidated.id).toBe(prompt.id);
    await channels.main.awaitPost({
      description: 'the boot notice stating the downtime window and abandoned work',
      match: (post) =>
        post.text.includes('Online') && post.text.includes('Offline since') && post.text.includes('abandoned')
    });

    const reply = `alive-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'still there' }, textResponse(reply));
    await channels.main.mention('mira', 'still there?');
    await channels.main.awaitReplyFrom('mira', { text: reply });
  });

  it('keeps queue state across a restart so pending work drains once channels go idle (§7.3)', async () => {
    const { app, channels, inference } = harness();
    inference.forgetRequests();
    const marker = `parked content ${randomUUID()}`;
    const queuedText = `queued-work-${randomUUID()}`;
    const drainReply = `drained-after-restart-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'park yourself' },
      toolCallResponse('workspace__write', { content: marker, path: 'parked.md' })
    );

    await channels.main.mention('mira', 'park yourself');
    await channels.main.awaitPost({
      description: 'the approval prompt holding the channel busy',
      match: (post) => post.text.includes('Approval required') && post.text.includes(marker)
    });
    const queued = await channels.main.mention('mira', queuedText);
    await channels.main.awaitReaction(queued, QUEUED_ACKNOWLEDGEMENT_EMOJI);

    inference.willReply({ agent: 'mira' }, textResponse(drainReply));
    await app.restart();
    await channels.main.awaitReplyFrom('mira', { text: drainReply });

    const drainRequest = inference.requestsFor('mira').at(-1);
    expect(drainRequest?.messages.some((message) => message.content?.includes(queuedText))).toBe(true);
  });
});

describe('Backfill', () => {
  const harness = setupHarness(SCENARIO);

  it('imports posts made while the process was down without starting turns for them (§8.2)', async () => {
    const { app, channels, inference } = harness();
    inference.forgetRequests();
    const fact = `the offsite is in lisbon ${randomUUID()}`;
    const missedMention = `while you were away ${randomUUID()}`;

    await app.stop();
    await channels.main.say(fact);
    await channels.main.mention('mira', missedMention);
    await app.start();

    const reply = `caught-up-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'what did I miss' }, textResponse(reply));
    await channels.main.mention('mira', 'what did I miss?');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    // the downtime posts are history in context, and the missed mention started no turn of its own
    const request = inference.requestsFor('mira').at(-1);
    expect(request?.messages.some((message) => message.content?.includes(fact))).toBe(true);
    expect(request?.messages.some((message) => message.content?.includes(missedMention))).toBe(true);
    expect(inference.requestsFor('mira')).toHaveLength(1);
  });

  it('imports each channel using that agent’s own token, never a privileged one (§8.2)', async () => {
    const { app, channels, inference } = harness();
    const secret = `owen-only ${randomUUID()}`;

    await app.stop();
    await channels['private-side'].say(secret);
    await app.start();

    const owenReply = `owen-sees-${randomUUID()}`;
    inference.willReply({ agent: 'owen', contains: 'side check' }, textResponse(owenReply));
    await channels['private-side'].mention('owen', 'side check');
    await channels['private-side'].awaitReplyFrom('owen', { text: owenReply });
    const owenRequest = inference.requestsFor('owen').at(-1);
    expect(owenRequest?.messages.some((message) => message.content?.includes(secret))).toBe(true);

    const miraReply = `mira-blind-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'main check' }, textResponse(miraReply));
    await channels.main.mention('mira', 'main check');
    await channels.main.awaitReplyFrom('mira', { text: miraReply });
    const miraRequest = inference.requestsFor('mira').at(-1);
    expect(miraRequest?.messages.some((message) => message.content?.includes(secret))).toBe(false);
  });
});

describe('Context assembly', () => {
  const harness = setupHarness(DEFAULT_SCENARIO);

  it('assembles a turn’s context from SQLite without reading the Mattermost API (§8.2)', async () => {
    const { channels, inference } = harness();
    const fact = `the launch is on thursday ${randomUUID()}`;
    const reply = `noted-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'launch' }, textResponse(reply));

    await channels.main.say(fact);
    await channels.main.mention('mira', 'when is the launch?');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    const request = inference.requestsFor('mira').at(-1);
    const history = request?.messages.filter((message) => message.role === 'user') ?? [];
    expect(history.some((message) => message.content.includes(fact))).toBe(true);
  });
});
