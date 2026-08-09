import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { textResponse } from '../../support/inference.ts';
import { DEFAULT_SCENARIO } from '../../support/scenario.ts';

describe('Mentions', () => {
  const harness = setupHarness(DEFAULT_SCENARIO);

  it.each(DEFAULT_SCENARIO.agents)('$username replies when mentioned', async ({ username }) => {
    const { channels, inference } = harness();
    const expectedReply = `${username} replied`;
    inference.willReply({ agent: username }, textResponse(expectedReply));

    await channels.main.mention(username, 'ping');
    const reply = await channels.main.awaitReplyFrom(username);

    expect(reply.text).toBe(expectedReply);
  });

  it('sends the agent its own system prompt', async () => {
    const { channels, inference } = harness();
    inference.willReply({ agent: 'mira' }, textResponse('pong'));

    await channels.main.mention('mira', 'ping');
    await channels.main.awaitReplyFrom('mira', { text: 'pong' });

    const [request] = inference.requestsFor('mira').slice(-1);
    expect(request?.systemPrompt).toContain('You are Mira');
  });
});
