import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { textResponse } from '../../support/inference.ts';
import { defineScenario } from '../../support/scenario.ts';

/**
 * Covers the harness itself rather than any obligation in SPEC.md. Most of what the roadmap's e2e
 * tests will rely on cannot be exercised until the turn engine exists, so this file proves the
 * fixtures work now instead of discovering they do not much later.
 */

const HARNESS_SCENARIO = defineScenario({
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
    }
  ],
  channels: [{ name: 'main' }, { members: ['mira'], name: 'dm', type: 'direct' }]
});

describe('Harness fixtures', () => {
  const harness = setupHarness(HARNESS_SCENARIO);

  it('holds a completion open until it is released', async () => {
    const { channels, inference } = harness();
    const blocked = inference.willBlock({ agent: 'mira' }, textResponse('released'));

    await channels.main.mention('mira', 'ping');
    await blocked.arrived;

    expect(await channels.main.posts()).not.toContainEqual(expect.objectContaining({ text: 'released' }));

    blocked.release();
    await channels.main.awaitReplyFrom('mira', { text: 'released' });
  });

  it('provisions a direct channel the agent answers in', async () => {
    const { channels, inference } = harness();
    inference.willReply({ agent: 'mira' }, textResponse('direct reply'));

    await channels.dm.say('ping');

    await channels.dm.awaitReplyFrom('mira', { text: 'direct reply' });
  });

  it('observes ephemeral posts, which never appear in the channel', async () => {
    const { channels } = harness();

    await channels.main.emitEphemeral('ephemeral probe');

    const ephemeral = await channels.main.awaitEphemeral({ contains: 'ephemeral probe' });
    expect(ephemeral.channelId).toBe(channels.main.id);
    expect(await channels.main.posts()).not.toContainEqual(expect.objectContaining({ text: ephemeral.message }));
  });

  it('records the tools an agent was offered — the core tools even when nothing is granted (§8)', async () => {
    const { channels, inference } = harness();
    inference.willReply({ agent: 'owen' }, textResponse('pong'));

    await channels.main.mention('owen', 'ping');
    await channels.main.awaitReplyFrom('owen', { text: 'pong' });

    const [request] = inference.requestsFor('owen').slice(-1);
    expect(request?.toolNames).toEqual(['builtins__now', 'skills__load', 'triggers__resolve']);
  });
});
