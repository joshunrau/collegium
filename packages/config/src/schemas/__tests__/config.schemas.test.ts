import type { PartialDeep } from 'type-fest';
import { describe, expect, it } from 'vitest';

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
  it('should take plugins as names alone — the directory and the namespace are one identity (§3.14)', () => {
    expect($Config.safeParse({ ...config, plugins: ['bookmark'] }).success).toBe(true);
    const withPath = { ...config, plugins: [{ name: 'bookmark', path: './plugins/bookmark' }] };
    expect($Config.safeParse(withPath).success).toBe(false);
  });
  it('should reject a plugin name outside the namespace grammar', () => {
    expect($Config.safeParse({ ...config, plugins: ['../escape'] }).success).toBe(false);
  });
  it('should reject a plugin named twice', () => {
    expect($Config.safeParse({ ...config, plugins: ['bookmark', 'bookmark'] }).success).toBe(false);
  });
});
