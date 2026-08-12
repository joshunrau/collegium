import { describe, expect, it } from 'vitest';

import { setupProvisioning } from '../../support/provisioning.ts';

describe('Provisioning', () => {
  // twice, because it runs on every start against a server that already holds what it asks for
  const provisioning = setupProvisioning({ runs: 2 });

  it('should keep one token per declared account', () => {
    const usernames = provisioning.runs[0]?.map(({ username }) => username);
    expect(usernames).toStrictEqual([provisioning.usernames.agent, provisioning.usernames.systemBot].sort());
  });

  // Mattermost reveals a token once, so a second mint would orphan the one already in use
  it('should mint nothing on a second run against a server it already provisioned', () => {
    expect(provisioning.runs[1]).toStrictEqual(provisioning.runs[0]);
  });

  it('should mint a token that authenticates as the account it belongs to', async () => {
    const agent = provisioning.runs[0]?.find(({ username }) => username === provisioning.usernames.agent);
    await expect(provisioning.identify(agent?.token ?? '')).resolves.toBe(provisioning.usernames.agent);
  });

  it('should join every account it creates to the main channel', async () => {
    await expect(provisioning.isMainChannelMember(provisioning.usernames.agent)).resolves.toBe(true);
    await expect(provisioning.isMainChannelMember(provisioning.usernames.systemBot)).resolves.toBe(true);
  });
});
