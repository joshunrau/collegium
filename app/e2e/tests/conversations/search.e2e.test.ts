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
      tools: ['conversations'],
      username: 'mira'
    }
  ],
  channels: [{ name: 'main' }, { name: 'side' }, { members: ['mira'], name: 'dm', type: 'direct' }]
});

describe('Conversation search', () => {
  const harness = setupHarness(SCENARIO);

  /** the tool result the turn's final completion request carried back to the model */
  const lastToolResult = () => {
    const { inference } = harness();
    return inference
      .requestsFor('mira')
      .at(-1)
      ?.messages.findLast((message) => message.role === 'tool')?.content;
  };

  it('finds a phrase posted earlier in another public channel, whatever its case (§3.8)', async () => {
    const { channels, inference } = harness();
    const marker = `figure-${randomUUID()}`;
    const reply = `found-${randomUUID()}`;
    await channels.side.say(`the Budget figure is ${marker}`);

    inference.willReply(
      { agent: 'mira', contains: 'look it up' },
      toolCallResponse('conversations__search', { query: marker.toUpperCase() })
    );
    inference.willReply({ agent: 'mira' }, textResponse(reply));
    await channels.main.mention('mira', 'look it up');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    const result = lastToolResult();
    expect(result).toContain(`in ${channels.side.name}`);
    expect(result).toContain(`> the Budget figure is ${marker}`);
  });

  it('finds the agent’s own earlier reply but not its status text (§3.8)', async () => {
    const { channels, inference } = harness();
    const promise = `promised-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'promise me' }, textResponse(`I will: ${promise}`));
    await channels.main.mention('mira', 'promise me');
    await channels.main.awaitReplyFrom('mira', { text: `I will: ${promise}` });

    const reply = `recalled-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'what did you promise' },
      toolCallResponse('conversations__search', { query: promise })
    );
    inference.willReply({ agent: 'mira' }, textResponse(reply));
    await channels.main.mention('mira', 'what did you promise');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    const result = lastToolResult();
    expect(result).toContain(`> I will: ${promise}`);
    expect(result).not.toContain('conversations::search');
  });

  it('never surfaces a direct message in a public channel, yet reaches public posts from the DM (§3.8)', async () => {
    const { channels, inference } = harness();
    const secret = `secret-${randomUUID()}`;
    const open = `open-${randomUUID()}`;
    const acknowledged = `ack-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: secret }, textResponse(acknowledged));
    await channels.dm.say(`between us: ${secret}`);
    await channels.dm.awaitReplyFrom('mira', { text: acknowledged });
    await channels.main.say(`for everyone: ${open}`);

    const publicReply = `public-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'search from public' },
      toolCallResponse('conversations__search', { query: secret })
    );
    inference.willReply({ agent: 'mira' }, textResponse(publicReply));
    await channels.main.mention('mira', 'search from public');
    await channels.main.awaitReplyFrom('mira', { text: publicReply });
    expect(lastToolResult()).toBe('no posts matched');

    const dmReply = `dm-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'search from dm' },
      toolCallResponse('conversations__search', { query: open })
    );
    inference.willReply({ agent: 'mira' }, textResponse(dmReply));
    await channels.dm.say('search from dm');
    await channels.dm.awaitReplyFrom('mira', { text: dmReply });
    expect(lastToolResult()).toContain(`> for everyone: ${open}`);
  });
});
