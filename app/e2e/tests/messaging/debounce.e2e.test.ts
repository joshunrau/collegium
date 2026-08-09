import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { textResponse } from '../../support/inference.ts';
import { defineScenario } from '../../support/scenario.ts';

const DEBOUNCE = { ceilingMs: 1200, windowMs: 300 } as const;

const SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: [],
      username: 'mira'
    }
  ],
  channels: [{ name: 'main' }],
  debounce: DEBOUNCE
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Debounce', () => {
  const harness = setupHarness(SCENARIO);

  it('folds fragments posted inside the window into a single turn (§4.4)', async () => {
    const { channels, inference } = harness();
    const marker = randomUUID().slice(0, 8);
    const fragments = [`one-${marker}`, `two-${marker}`, `three-${marker}`];
    const reply = `folded-${marker}`;
    inference.willReply({ agent: 'mira' }, textResponse(reply));
    const before = inference.requestsFor('mira').length;

    const [opening, ...rest] = fragments;
    await channels.main.mention('mira', `${opening}`);
    for (const fragment of rest) {
      await channels.main.say(fragment);
    }
    await channels.main.awaitReplyFrom('mira', { text: reply });
    await sleep(DEBOUNCE.ceilingMs);

    const requests = inference.requestsFor('mira').slice(before);
    expect(requests).toHaveLength(1);
    for (const fragment of fragments) {
      expect(JSON.stringify(requests[0]?.messages)).toContain(fragment);
    }
  });

  it('folds a fragment that arrives while the model is generating into the same turn (§4.4)', async () => {
    const { channels, inference } = harness();
    const marker = randomUUID().slice(0, 8);
    const opening = `opening-${marker}`;
    const late = `late-${marker}`;
    const reply = `absorbed-${marker}`;
    const held = inference.willBlock({ agent: 'mira' }, textResponse(`half-${marker}`));
    inference.willReply({ agent: 'mira' }, textResponse(reply));
    const before = inference.requestsFor('mira').length;

    await channels.main.mention('mira', opening);
    // the window has already elapsed: the turn exists and is provably inside its first completion
    await held.arrived;
    await channels.main.say(late);
    held.release();
    await channels.main.awaitReplyFrom('mira', { text: reply });

    const requests = inference.requestsFor('mira').slice(before);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.messages)).toContain(opening);
    expect(JSON.stringify(requests[1]?.messages)).toContain(late);
  });

  it('starts a turn at the ceiling while fragments are still arriving (§4.4)', async () => {
    const { channels, inference } = harness();
    const marker = randomUUID().slice(0, 8);
    // a turn opening at the ceiling leaves the later fragments to the running turn to absorb,
    // so the count is generous on purpose: how many folds land is a matter of timing
    inference.willReply({ agent: 'mira' }, textResponse(`ceiling-${marker}`), { times: 4 });
    const before = inference.requestsFor('mira').length;

    const trailing = Array.from({ length: 8 }, (_, index) => `trailing-${index}-${marker}`);
    const last = `trailing-7-${marker}`;
    await channels.main.mention('mira', `start-${marker}`);
    for (const fragment of trailing) {
      await sleep(DEBOUNCE.windowMs - 100);
      await channels.main.say(fragment);
    }

    // the reply lands mid-loop, behind the watermark say() advances — the request is the evidence
    const forced = await inference.awaitRequestFor('mira', before);
    expect(JSON.stringify(forced.messages)).toContain(`start-${marker}`);
    expect(JSON.stringify(forced.messages)).not.toContain(last);
  });
});
