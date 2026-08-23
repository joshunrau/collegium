import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ConfigService } from '../config.service.ts';
import { EnvService } from '../env/env.service.ts';

import type { Config } from '../config.schemas.ts';

const config = {
  agents: [
    {
      expertise: 'programming',
      model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
      skills: [],
      systemPrompt: 'You are Mira Turner',
      tools: [],
      toolSettings: {},
      username: 'mira'
    }
  ],
  app: {
    contextBudgetTokens: 8000,
    debounce: { ceilingMs: 15_000, windowMs: 3000 },
    defaultToolSettings: {},
    enableLifecycleNotifications: true,
    inferenceRetry: { backoffMs: 250, maxAttempts: 3 },
    inferenceTimeoutMs: 120_000,
    logLevel: 'error',
    timezone: 'America/Toronto',
    turnCeilingPerHour: 250
  },
  channels: [],
  mattermost: { mainChannel: 'main', systemBotUsername: 'orchestrator' },
  models: { deepseek: { apiKey: 'key_1', baseUrl: 'https://api.deepseek.com' } }
} satisfies Config;

function compileConfigService(envService: MockedInstance<EnvService>) {
  return Test.createTestingModule({
    providers: [ConfigService, { provide: EnvService, useValue: envService }]
  }).compile();
}

describe('ConfigService', () => {
  let configService: ConfigService;
  let envService: MockedInstance<EnvService>;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-config-'));
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(config));
    fs.writeFileSync(path.join(tmpDir, 'invalid.json'), JSON.stringify({}));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  beforeEach(async () => {
    envService = MockFactory.createMock(EnvService);
    envService.get.mockReturnValue(path.join(tmpDir, 'config.json'));
    const moduleRef = await compileConfigService(envService);
    configService = moduleRef.get(ConfigService);
  });

  it('should return a nested config value', () => {
    expect(configService.get('app.timezone')).toBe('America/Toronto');
  });

  it('should throw naming a config file that cannot be read', async () => {
    const filepath = path.join(tmpDir, 'missing.json');
    envService.get.mockReturnValue(filepath);

    await expect(compileConfigService(envService)).rejects.toThrow(`failed to read config at "${filepath}"`);
  });

  it('should throw naming a config file that fails validation', async () => {
    const filepath = path.join(tmpDir, 'invalid.json');
    envService.get.mockReturnValue(filepath);

    await expect(compileConfigService(envService)).rejects.toThrow(`invalid config at "${filepath}"`);
  });
});
