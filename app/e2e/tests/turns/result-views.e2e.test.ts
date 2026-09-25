import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { textResponse, toolCallResponse } from '../../support/inference.ts';
import { defineScenario } from '../../support/scenario.ts';

/** §3.8 — a 40,000-token ceiling gives a view of 6,000 tokens, 24,000 characters; the record is five times that */
const CEILING_TOKENS = 40_000;
const VIEW_CHARS = 24_000;
const FACT = 'the vault code is 7319';
const MANUAL = `${'The vault manual, one line of filler after another.\n'.repeat((VIEW_CHARS * 5) / 52)}${FACT}.\n`;

const SCENARIO = defineScenario({
  agents: [
    {
      contextBudgetTokens: 3_000,
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: ['memory'],
      toolSettings: { memory: { maxBodyChars: 130_000 } },
      turnContextCeilingTokens: CEILING_TOKENS,
      username: 'mira'
    }
  ],
  channels: [{ name: 'main' }]
});

describe('A long result read on by reference (§3.8)', () => {
  const harness = setupHarness(SCENARIO);

  it('should show a result five times its view in part, and reach a fact past the view with results__read', async () => {
    const { channels, inference } = harness();
    inference.willReply(
      { agent: 'mira', contains: 'keep the manual' },
      toolCallResponse('memory__write', { body: MANUAL, description: 'the vault manual' })
    );
    inference.willReply({ agent: 'mira' }, textResponse('kept'));
    await channels.main.mention('mira', 'keep the manual');
    await channels.main.awaitReplyFrom('mira', { text: 'kept' });
    const written = inference.requestsFor('mira').at(-1)!.messages.at(-1)!.content ?? '';
    const reference = /memory (\w+)/u.exec(written)![1]!;

    inference.willReply({ agent: 'mira' }, toolCallResponse('memory__read', { reference }));
    inference.willReply({ agent: 'mira' }, toolCallResponse('results__read', { find: ['vault code'], ref: 'r1' }));
    inference.willReply({ agent: 'mira' }, textResponse(FACT));
    await channels.main.mention('mira', 'what is the vault code?');
    await channels.main.awaitReplyFrom('mira', { text: FACT });

    const [, , , afterRead, afterFind] = inference.requestsFor('mira');
    const viewed = afterRead!.messages.at(-1)!.content ?? '';
    expect(viewed).toContain('read the rest with results__read ref=r1');
    expect(viewed).not.toContain(FACT);
    expect(afterFind!.messages.at(-1)!.content ?? '').toContain(FACT);
    for (const request of inference.requestsFor('mira')) {
      expect(JSON.stringify(request).length / 4).toBeLessThan(CEILING_TOKENS);
    }
  });
});
