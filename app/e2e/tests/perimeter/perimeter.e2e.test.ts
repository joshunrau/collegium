import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { defineScenario } from '../../support/scenario.ts';

const SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: [],
      username: 'mira'
    }
  ],
  channels: [{ name: 'main' }]
});

describe('Callback perimeters', () => {
  const harness = setupHarness(SCENARIO);

  const post = async (path: string, body: unknown) => {
    const { app } = harness();
    return fetch(`${app.url}${path}`, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
  };

  it.each(['/triggers', '/decisions', '/commands'])(
    'answers 400 rather than 500 when %s receives a body its schema rejects',
    async (path) => {
      expect((await post(path, {})).status).toBe(400);
      expect((await post(path, { nonsense: true })).status).toBe(400);
    }
  );

  it('answers 400 for a well-formed body carrying an invalid enum', async () => {
    const response = await post('/triggers', {
      reference: { subject: 'anything' },
      source: 'cron',
      targetAgentUsername: 'mira',
      targetChannelId: 'channel'
    });
    expect(response.status).toBe(400);
  });
});
