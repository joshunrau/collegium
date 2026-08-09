import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { textResponse, toolCallResponse } from '../../support/inference.ts';
import { defineScenario } from '../../support/scenario.ts';

const SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      skills: ['handing-work-to-a-peer'],
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: ['load_skill', 'read_memory', 'write_memory'],
      username: 'mira'
    },
    {
      expertise: 'Research and information gathering',
      systemPrompt: 'You are Owen. Reply clearly and briefly.',
      username: 'owen'
    }
  ],
  channels: [{ name: 'main' }]
});

describe('Context assembly', () => {
  const harness = setupHarness(SCENARIO);

  const completeTurn = async (prompt: string) => {
    const { channels, inference } = harness();
    const reply = `reply-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: prompt }, textResponse(reply));
    await channels.main.mention('mira', prompt);
    await channels.main.awaitReplyFrom('mira', { text: reply });
    return inference.requestsFor('mira').at(-1);
  };

  it('carries the skill manifest in the system prompt (§3.5)', async () => {
    const request = await completeTurn('manifest check');
    expect(request?.systemPrompt).toContain('handing-work-to-a-peer');
  });

  it('carries memory descriptions in the system prompt once a memory exists (§3.6)', async () => {
    const { channels, inference } = harness();
    const description = `casey-prefers-${randomUUID()}`;
    const firstReply = `saved-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'remember' },
      toolCallResponse('write_memory', { body: 'bullet points, always', description })
    );
    inference.willReply({ agent: 'mira' }, textResponse(firstReply));
    await channels.main.mention('mira', 'remember my preference');
    await channels.main.awaitReplyFrom('mira', { text: firstReply });

    const request = await completeTurn('memory check');
    expect(request?.systemPrompt).toContain(description);
  });

  it('carries the peer roster in the system prompt (§3.11)', async () => {
    const { agents } = harness();
    const request = await completeTurn('roster check');
    expect(request?.systemPrompt).toContain(`@${agents.owen.username}`);
    expect(request?.systemPrompt).toContain('Research and information gathering');
  });
});
