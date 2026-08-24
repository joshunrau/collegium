import type { $Env } from '@collegium/config';

import { EnvService } from '@/config/env/env.service.ts';

import { MockFactory } from './mock.factory.ts';

import type { MockedInstance } from './mock.factory.ts';

const baseEnv = (): $Env => ({
  APP_HOST: 'localhost',
  APP_PORT: 3000,
  APP_PUBLIC_URL: 'http://localhost:3000',
  CONFIG_PATH: '/tmp/collegium-test/config.json',
  DATABASE_URL: 'file:///tmp/collegium-test/db.sqlite',
  MATTERMOST_TEAM: 'collegium',
  MATTERMOST_URL: 'http://localhost:8065',
  WORKSPACE_ROOT: '/tmp/collegium-test-workspaces'
});

export function createEnvServiceMock(overrides: Partial<$Env> = {}): MockedInstance<EnvService> {
  const env = { ...baseEnv(), ...overrides };
  const mock = MockFactory.createMock(EnvService);
  mock.get.mockImplementation((key) => env[key]);
  return mock;
}
