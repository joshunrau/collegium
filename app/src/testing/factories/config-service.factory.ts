import { CONFIG_DEFAULTS } from '@collegium/config';
import type { $Config } from '@collegium/config';
import { get, merge } from 'es-toolkit/compat';
import type { PartialDeep } from 'type-fest';

import { ConfigService } from '@/config/config.service.ts';

import { MockFactory } from './mock.factory.ts';

import type { MockedInstance } from './mock.factory.ts';

const baseConfig = (): $Config => ({
  activation: {
    debounce: { ...CONFIG_DEFAULTS.activation.debounce },
    foldLimit: CONFIG_DEFAULTS.activation.foldLimit
  },
  agentDefaults: {
    contextBudgetTokens: CONFIG_DEFAULTS.agentDefaults.contextBudgetTokens,
    toolSettings: {}
  },
  agents: {},
  display: { ...CONFIG_DEFAULTS.display },
  inference: {
    retry: { ...CONFIG_DEFAULTS.inference.retry },
    timeoutMs: CONFIG_DEFAULTS.inference.timeoutMs
  },
  logging: { ...CONFIG_DEFAULTS.logging },
  mattermost: {
    channels: {},
    mainChannel: CONFIG_DEFAULTS.mattermost.mainChannel,
    systemBotUsername: CONFIG_DEFAULTS.mattermost.systemBotUsername
  },
  notifications: { ...CONFIG_DEFAULTS.notifications },
  plugins: [],
  providers: { deepseek: { apiKey: 'key', baseUrl: CONFIG_DEFAULTS.providers.deepseek.baseUrl } },
  turns: { ...CONFIG_DEFAULTS.turns }
});

/**
 * A ConfigService mock answering every key from the real shipped defaults, so a changed default
 * flows into tests instead of going stale in a hand-written switch. Dotted-path resolution is the
 * same `get` the real service uses.
 */
export function createConfigServiceMock(overrides: PartialDeep<$Config> = {}): MockedInstance<ConfigService> {
  const config = merge(baseConfig(), overrides);
  const mock = MockFactory.createMock(ConfigService);
  mock.get.mockImplementation((key) => get(config, key));
  return mock;
}
