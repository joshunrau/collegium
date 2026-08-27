import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ConfigInput } from '@collegium/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ConfigService } from '../config.service.ts';
import { EnvService } from '../env/env.service.ts';

const config = {
  $schema: 'https://collegium.sh/config.schema.json',
  agentDefaults: {
    model: { name: 'deepseek-v4-flash', provider: 'deepseek' }
  },
  agents: {
    mira: {
      expertise: 'programming',
      systemPrompt: 'You are Mira Turner'
    }
  },
  display: { timezone: 'America/Toronto' },
  logging: { level: 'error' },
  providers: { deepseek: { apiKey: 'key_1' } }
} satisfies ConfigInput;

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
    expect(configService.get('display.timezone')).toBe('America/Toronto');
  });

  it('should hand out agents resolved against agentDefaults, keyed and named by username', () => {
    expect(configService.get('agents.mira')).toMatchObject({
      contextBudgetTokens: 8000,
      model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
      username: 'mira'
    });
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
