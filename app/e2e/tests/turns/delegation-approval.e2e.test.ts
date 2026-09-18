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
      tools: [],
      username: 'mira'
    },
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Owen. Reply clearly and briefly.',
      tools: ['memory', 'workspace'],
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

describe('Delegation across a gate', () => {
  const harness = setupHarness(SCENARIO);

  // no post renders either counter, so both cases read the recorded row from the turn's own trace (§8.3)
  const traceOf = async (postId: string) => {
    const { channels } = harness();
    channels.main.forgetInteractions();
    await channels.main.runCommand(`/collegium trace ${postId}`);
    const { message } = await channels.main.awaitEphemeral({ contains: 'depth' });
    return message;
  };

  it('blocks a delegating turn on a real approval prompt before the hand-off, and starts the peer at the correct depth once approved (§3.7, §7.4)', async () => {
    const { agents, channels, inference } = harness();
    const phrase = `hand down ${randomUUID()}`;
    const marker = `gated-${randomUUID()}`;
    const handed = `handed-${randomUUID()}`;
    const omarRequests = () => inference.requestsFor('omar').length;
    const before = omarRequests();
    inference.willReply({ agent: 'mira', contains: phrase }, textResponse(`@${agents.owen.username} ${phrase}`));
    inference.willReply(
      { agent: 'owen', contains: phrase },
      toolCallResponse('workspace__write', { content: marker, path: 'delegation.md' })
    );

    await channels.main.mention('mira', phrase);
    const prompt = await channels.main.awaitPost({
      description: 'the approval prompt holding the hand-off',
      match: (post) => post.text.includes('Approval required') && post.text.includes(marker)
    });
    expect(omarRequests()).toBe(before);

    inference.willReply({ agent: 'owen' }, textResponse(`@${agents.omar.username} ${phrase}`));
    inference.willReply({ agent: 'omar', contains: phrase }, textResponse(handed));
    await channels.main.clickAction(prompt, 'approve');
    const reply = await channels.main.awaitReplyFrom('omar', { text: handed });

    expect(omarRequests()).toBe(before + 1);
    expect(await traceOf(reply.id)).toContain('depth 2, chain 3');
  });

  it('preserves depth and chain-length accounting across a mid-chain budget extension (§5.3, §7.4)', async () => {
    const { agents, channels, inference } = harness();
    const phrase = `push on ${randomUUID()}`;
    const returned = `returned-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: phrase }, textResponse(`@${agents.owen.username} ${phrase}`));
    inference.willReply(
      { agent: 'owen', contains: phrase },
      toolCallsResponse(
        Array.from({ length: 11 }, (_, index) => ({
          arguments: { body: `note ${index} ${phrase}`, description: `filler ${index}` },
          name: 'memory__write'
        }))
      )
    );

    await channels.main.mention('mira', phrase);
    const extension = await channels.main.awaitPost({
      description: 'the extension prompt from the delegate',
      match: (post) => post.authorId === agents.owen.userId && post.text.includes('extension 1; 10 attempts so far')
    });

    inference.willReply({ agent: 'owen' }, textResponse(`@${agents.mira.username} ${phrase}`));
    inference.willReply({ agent: 'mira' }, textResponse(returned));
    await channels.main.clickAction(extension, 'approve');
    const reply = await channels.main.awaitReplyFrom('mira', { text: returned });

    expect(await traceOf(reply.id)).toContain('depth 0, chain 3');
  });
});
