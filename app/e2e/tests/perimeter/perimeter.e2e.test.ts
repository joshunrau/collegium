import { describe, expect, it } from 'vitest';

import { E2E_CALLBACK_TOKEN, E2E_TRIGGER_TOKEN } from '../../support/env.ts';
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

  const post = async (path: string, body: unknown, token?: string) => {
    const { app } = harness();
    return fetch(`${app.url}${path}`, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      method: 'POST'
    });
  };

  it.each([
    ['/triggers', E2E_TRIGGER_TOKEN],
    ['/decisions', undefined],
    ['/commands', E2E_CALLBACK_TOKEN]
  ])('answers 400 rather than 500 when %s receives a body its schema rejects', async (path, token) => {
    expect((await post(path, {}, token)).status).toBe(400);
    expect((await post(path, { nonsense: true }, token)).status).toBe(400);
  });

  it.each([
    ['/triggers', E2E_CALLBACK_TOKEN],
    ['/commands', E2E_TRIGGER_TOKEN]
  ])('answers 401 when %s is presented no token, or the other route’s (§6.4)', async (path, other) => {
    expect((await post(path, {})).status).toBe(401);
    expect((await post(path, {}, other)).status).toBe(401);
  });

  it('answers 401 for a decision whose signature was not minted for it (§6.4)', async () => {
    const response = await post('/decisions', {
      context: { action: 'approve', approval_id: 'approval-1', signature: 'forged' },
      user_id: 'user-1',
      user_name: 'casey'
    });
    expect(response.status).toBe(401);
  });

  it('answers 400 for a well-formed body carrying an invalid enum', async () => {
    const response = await post(
      '/triggers',
      { reference: { subject: 'anything' }, source: 'cron', targetAgentUsername: 'mira', targetChannelId: 'channel' },
      E2E_TRIGGER_TOKEN
    );
    expect(response.status).toBe(400);
  });
});
