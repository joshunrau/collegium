import { get, merge } from 'es-toolkit/compat';
import type { PartialDeep } from 'type-fest';

import { CONFIG_DEFAULTS } from '@/config/config.constants.ts';
import type { Config } from '@/config/config.schemas.ts';
import { ConfigService } from '@/config/config.service.ts';

import { MockFactory } from './mock.factory.ts';

import type { MockedInstance } from './mock.factory.ts';

const baseConfig = (): Config => ({
  agents: [],
  app: {
    ...CONFIG_DEFAULTS.app,
    debounce: { ...CONFIG_DEFAULTS.app.debounce },
    inferenceRetry: { ...CONFIG_DEFAULTS.app.inferenceRetry },
    memoryCaps: { ...CONFIG_DEFAULTS.app.memoryCaps }
  },
  channels: [],
  mattermost: { mainChannelId: 'channel', systemBotToken: 'token', url: 'http://localhost:8065' },
  models: { deepseek: { apiKey: 'key', baseUrl: CONFIG_DEFAULTS.models.deepseek.baseUrl } }
});

/**
 * A ConfigService mock answering every key from the real shipped defaults, so a changed default
 * flows into tests instead of going stale in a hand-written switch. Dotted-path resolution is the
 * same `get` the real service uses.
 */
export function createConfigServiceMock(overrides: PartialDeep<Config> = {}): MockedInstance<ConfigService> {
  const config = merge(baseConfig(), overrides);
  const mock = MockFactory.createMock(ConfigService);
  mock.get.mockImplementation((key) => get(config, key));
  return mock;
}
