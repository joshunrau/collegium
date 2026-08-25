import * as fs from 'node:fs';
import * as path from 'node:path';

import { toConfigJsonSchema } from '@collegium/config';
import type { PartialDeep } from 'type-fest';
import { describe, expect, it } from 'vitest';

import { GRANTABLE_TOOLSETS } from '@/tools/tools.toolsets.ts';

import { $AgentDefinition, $Config } from '../config.schemas.ts';

import type { Config } from '../config.schemas.ts';

const definition = (tools: $AgentDefinition['tools']): $AgentDefinition => ({
  expertise: 'programming',
  model: {
    name: 'deepseek-v4-flash',
    provider: 'deepseek'
  },
  skills: [],
  systemPrompt: 'You are Mira Turner',
  tools,
  toolSettings: {},
  username: 'mira'
});

const config: PartialDeep<Config> = {
  agents: [definition([])],
  mattermost: { mainChannel: 'main', systemBotUsername: 'orchestrator' },
  models: { deepseek: { apiKey: 'key_1' } }
};

describe('$AgentDefinition', () => {
  it('should accept a namespace grant and a single-tool ref', () => {
    expect($AgentDefinition.safeParse(definition(['memory'])).success).toBe(true);
    expect($AgentDefinition.safeParse(definition(['mail::list'])).success).toBe(true);
  });

  it('should accept a plugin grant in either shape, deferring existence to boot (§8)', () => {
    expect($AgentDefinition.safeParse(definition(['bookmark'])).success).toBe(true);
    expect($AgentDefinition.safeParse(definition(['bookmark::save'])).success).toBe(true);
  });

  it('should reject a core capability by namespace or by tool (§8)', () => {
    expect($AgentDefinition.safeParse(definition(['skills'])).success).toBe(false);
    expect($AgentDefinition.safeParse(definition(['skills::load'])).success).toBe(false);
    expect($AgentDefinition.safeParse(definition(['triggers::resolve'])).success).toBe(false);
  });

  it('should reject a grant outside the segment grammar', () => {
    expect($AgentDefinition.safeParse(definition(['Bookmark::save'])).success).toBe(false);
    expect($AgentDefinition.safeParse(definition(['mail__send'])).success).toBe(false);
  });

  it('should reject the core skill as a grant (§9)', () => {
    expect($AgentDefinition.safeParse({ ...definition([]), skills: ['handing-work-to-a-peer'] }).success).toBe(false);
  });

  it('should accept a qualified toolset skill', () => {
    expect($AgentDefinition.safeParse({ ...definition([]), skills: ['bookmark::saving-bookmarks'] }).success).toBe(
      true
    );
  });

  it('should default tools, skills, and toolSettings', () => {
    const parsed = $AgentDefinition.parse({
      ...definition([]),
      skills: undefined,
      tools: undefined,
      toolSettings: undefined
    });
    expect(parsed.tools).toStrictEqual([]);
    expect(parsed.skills).toStrictEqual([]);
    expect(parsed.toolSettings).toStrictEqual({});
  });

  it('should reject a toolSettings key outside the namespace grammar', () => {
    expect($AgentDefinition.safeParse({ ...definition([]), toolSettings: { 'no-good': {} } }).success).toBe(false);
  });
});

describe('$Config', () => {
  it('should apply config defaults', () => {
    expect($Config.parse(config)).toMatchObject({
      app: {
        defaultToolSettings: {},
        enableLifecycleNotifications: true,
        inferenceRetry: { backoffMs: 250, maxAttempts: 3 },
        inferenceTimeoutMs: 120_000,
        logLevel: 'info'
      },
      models: { deepseek: { baseUrl: 'https://api.deepseek.com' } }
    });
  });
  it('should accept an OpenRouter model and provider', () => {
    expect(
      $Config.safeParse({
        ...config,
        agents: [
          {
            ...definition([]),
            model: { name: 'anthropic/claude-sonnet-5', provider: 'openrouter' }
          }
        ],
        models: { openrouter: { apiKey: 'key_1' } }
      }).success
    ).toBe(true);
  });
  it('should reject duplicate agent usernames', () => {
    expect($Config.safeParse({ ...config, agents: [definition([]), definition([])] }).success).toBe(false);
  });
  it('should reject a config without a model provider', () => {
    expect($Config.safeParse({ ...config, models: {} }).success).toBe(false);
  });
  it('should reject a plugin ref carrying settings — they live in toolSettings now (§8)', () => {
    const withSettings = { ...config, plugins: [{ name: 'bookmark', path: './plugins/bookmark', settings: {} }] };
    expect($Config.safeParse(withSettings).success).toBe(false);
    const plain = { ...config, plugins: [{ name: 'bookmark', path: './plugins/bookmark' }] };
    expect($Config.safeParse(plain).success).toBe(true);
  });
});

describe('config.schema.json', () => {
  it('should match the schema generated from $Config (run `pnpm build:schema` if stale)', () => {
    const checkedInPath = path.resolve(import.meta.dirname, '../../../config.schema.json');
    const checkedIn: unknown = JSON.parse(fs.readFileSync(checkedInPath, 'utf-8'));
    expect(checkedIn).toStrictEqual(toConfigJsonSchema($Config, GRANTABLE_TOOLSETS));
  });

  it('should embed each framework settings schema with its top-level required stripped (§8)', () => {
    const schema = toConfigJsonSchema($Config, GRANTABLE_TOOLSETS) as unknown as {
      properties: {
        agents: { items: { properties: { toolSettings: { properties: { [key: string]: { required?: string[] } } } } } };
      };
    };
    const settings = schema.properties.agents.items.properties.toolSettings.properties;
    expect(Object.keys(settings)).toStrictEqual(['mail', 'memory']);
    expect(settings.mail?.required).toBeUndefined();
  });
});
