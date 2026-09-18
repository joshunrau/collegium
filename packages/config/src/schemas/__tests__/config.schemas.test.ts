import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { $Config } from '../config.resolution.ts';
import { $AgentDeclaration } from '../config.schemas.ts';

import type { ConfigInput } from '../config.resolution.ts';

const declaration = (tools: $AgentDeclaration['tools']): $AgentDeclaration => ({
  expertise: 'programming',
  model: {
    name: 'deepseek-v4-flash',
    provider: 'deepseek'
  },
  schedules: {},
  skills: [],
  systemPrompt: 'You are Mira Turner',
  tools,
  toolSettings: {}
});

const config: ConfigInput = {
  agents: { mira: declaration([]) },
  providers: { deepseek: { apiKey: 'key_1' } }
};

const schedule = (overrides: object) => ({
  channel: 'ops',
  prompt: 'Sweep the shared mailbox for anything that arrived overnight.',
  recurrence: { at: '08:30', every: 'weekday' },
  ...overrides
});

const scheduled = (schedules: object) => ({
  ...config,
  agents: { mira: { ...declaration([]), schedules } },
  mattermost: { channels: { ops: { triggeringMode: 'mention-required' } } }
});

const issuePaths = (input: unknown) => {
  return $Config.safeParse(input).error?.issues.map((issue) => issue.path.join('.')) ?? [];
};

describe('$AgentDeclaration', () => {
  it('should accept a namespace grant and a single-tool ref', () => {
    expect($AgentDeclaration.safeParse(declaration(['memory'])).success).toBe(true);
    expect($AgentDeclaration.safeParse(declaration(['mail::list'])).success).toBe(true);
  });

  it('should accept a plugin grant in either shape, deferring existence to boot (§8)', () => {
    expect($AgentDeclaration.safeParse(declaration(['bookmark'])).success).toBe(true);
    expect($AgentDeclaration.safeParse(declaration(['bookmark::save'])).success).toBe(true);
  });

  it('should reject a core capability by namespace or by tool (§8)', () => {
    expect($AgentDeclaration.safeParse(declaration(['skills'])).success).toBe(false);
    expect($AgentDeclaration.safeParse(declaration(['skills::load'])).success).toBe(false);
    expect($AgentDeclaration.safeParse(declaration(['triggers::resolve'])).success).toBe(false);
  });

  it('should reject a grant outside the segment grammar', () => {
    expect($AgentDeclaration.safeParse(declaration(['Bookmark::save'])).success).toBe(false);
    expect($AgentDeclaration.safeParse(declaration(['mail__send'])).success).toBe(false);
  });

  it('should reject the core skill as a grant (§9)', () => {
    expect($AgentDeclaration.safeParse({ ...declaration([]), skills: ['handing-work-to-a-peer'] }).success).toBe(false);
  });

  it('should accept a qualified toolset skill', () => {
    expect($AgentDeclaration.safeParse({ ...declaration([]), skills: ['bookmark::saving-bookmarks'] }).success).toBe(
      true
    );
  });

  it('should accept an agent’s own action budget and leave it absent otherwise (§5.3)', () => {
    expect($AgentDeclaration.parse({ ...declaration([]), actionBudget: 120 }).actionBudget).toBe(120);
    expect($AgentDeclaration.parse(declaration([])).actionBudget).toBeUndefined();
    expect($AgentDeclaration.safeParse({ ...declaration([]), actionBudget: 0 }).success).toBe(false);
  });

  it('should default tools, skills, and toolSettings', () => {
    const parsed = $AgentDeclaration.parse({
      ...declaration([]),
      skills: undefined,
      tools: undefined,
      toolSettings: undefined
    });
    expect(parsed.tools).toStrictEqual([]);
    expect(parsed.skills).toStrictEqual([]);
    expect(parsed.toolSettings).toStrictEqual({});
  });

  it('should accept a system prompt inline or as a resource path, and reject one that leaves the root (§3.1)', () => {
    const withPrompt = (systemPrompt: unknown) => $AgentDeclaration.safeParse({ ...declaration([]), systemPrompt });
    expect(withPrompt({ resource: 'prompts/mira.md' }).success).toBe(true);
    expect(withPrompt('').success).toBe(false);
    expect(withPrompt({ resource: '/etc/passwd' }).success).toBe(false);
    expect(withPrompt({ resource: '../secrets.md' }).success).toBe(false);
    expect(withPrompt({ extra: 1, resource: 'prompts/mira.md' }).success).toBe(false);
  });

  it('should reject a toolSettings key outside the namespace grammar', () => {
    expect($AgentDeclaration.safeParse({ ...declaration([]), toolSettings: { 'no-good': {} } }).success).toBe(false);
  });
});

describe('$Config', () => {
  it('should apply the shipped defaults to every section', () => {
    expect($Config.parse(config)).toMatchObject({
      activation: { debounce: { ceilingMs: 15_000, windowMs: 750 }, foldLimit: 3 },
      agentDefaults: { toolSettings: {} },
      display: { timezone: 'UTC' },
      inference: { retry: { backoffMs: 250, maxAttempts: 3 }, timeoutMs: 120_000 },
      logging: { level: 'info' },
      mattermost: { channels: {}, mainChannel: 'town-square', systemBotUsername: 'orchestrator' },
      notifications: { lifecycle: true, stalls: { longTurnMs: 1_800_000, standingQueueMs: 600_000 } },
      plugins: [],
      providers: { deepseek: { baseUrl: 'https://api.deepseek.com' } },
      turns: { actionBudget: 25, chainLengthLimit: 200, delegationDepthLimit: 10, hourlyCeiling: 500 }
    });
  });

  it('should carry each agent’s username in from its key and drop $schema', () => {
    const parsed = $Config.parse({ ...config, $schema: 'https://example.org/schema.json' });
    expect(parsed.agents.mira?.username).toBe('mira');
    expect(parsed).not.toHaveProperty('$schema');
  });

  it('should resolve an agent’s model and context budget from agentDefaults', () => {
    const parsed = $Config.parse({
      ...config,
      agentDefaults: { contextBudgetTokens: 12_000, model: { name: 'deepseek-v4-pro', provider: 'deepseek' } },
      agents: { mira: { ...declaration([]), contextBudgetTokens: undefined, model: undefined } }
    });
    expect(parsed.agents.mira).toMatchObject({
      contextBudgetTokens: 12_000,
      model: { name: 'deepseek-v4-pro', provider: 'deepseek' }
    });
  });

  it('should resolve an agent’s personality from agentDefaults and let the agent override it', () => {
    const parsed = $Config.parse({
      ...config,
      agentDefaults: { personality: 'candid' },
      agents: { mira: declaration([]), tess: { ...declaration([]), personality: undefined } }
    });
    expect(parsed.agents.mira?.personality).toBe('candid');
    expect(parsed.agents.tess?.personality).toBe('candid');
  });

  it('should leave personality undefined when neither place states one', () => {
    expect($Config.parse(config).agents.mira?.personality).toBeUndefined();
  });

  it('should let an agent override a default, and take a share of its model’s window when neither states a budget', () => {
    const parsed = $Config.parse({
      ...config,
      agentDefaults: { model: { name: 'deepseek-v4-pro', provider: 'deepseek' } }
    });
    expect(parsed.agents.mira).toMatchObject({
      contextBudgetTokens: 250_000,
      model: { name: 'deepseek-v4-flash', provider: 'deepseek' }
    });
  });

  it('should refuse an agent with no model in either place', () => {
    expect(issuePaths({ ...config, agents: { mira: { ...declaration([]), model: undefined } } })).toStrictEqual([
      'agents.mira.model'
    ]);
  });

  it('should refuse a provider a model names but nothing configures', () => {
    expect(issuePaths({ ...config, providers: {} })).toStrictEqual(['providers.deepseek']);
  });

  it('should accept an OpenRouter model against a configured OpenRouter provider', () => {
    const openrouter = {
      ...config,
      agents: { mira: { ...declaration([]), model: { name: 'anthropic/claude-sonnet-5', provider: 'openrouter' } } },
      providers: { openrouter: { apiKey: 'key_1' } }
    } satisfies ConfigInput;
    expect($Config.safeParse(openrouter).success).toBe(true);
  });

  it('should accept a reasoning effort in the provider’s own vocabulary and refuse another’s', () => {
    const withEffort = (model: unknown) => ({ ...config, agents: { mira: { ...declaration([]), model } } });
    expect(
      $Config.safeParse(withEffort({ name: 'deepseek-v4-flash', provider: 'deepseek', reasoningEffort: 'max' })).success
    ).toBe(true);
    expect(
      issuePaths(withEffort({ name: 'deepseek-v4-flash', provider: 'deepseek', reasoningEffort: 'medium' }))
    ).toStrictEqual(['agents.mira.model.reasoningEffort']);
  });

  it('should refuse a config with no agent', () => {
    expect(issuePaths({ ...config, agents: {} })).toStrictEqual(['agents']);
  });

  it('should refuse an agent key outside the username grammar', () => {
    expect($Config.safeParse({ ...config, agents: { 'Mira!': declaration([]) } }).success).toBe(false);
  });

  it('should refuse the system bot username as an agent key', () => {
    expect(issuePaths({ ...config, mattermost: { systemBotUsername: 'mira' } })).toStrictEqual([
      'mattermost.systemBotUsername'
    ]);
  });

  it('should refuse a respond-to-all main channel', () => {
    const input = { ...config, mattermost: { channels: { 'town-square': { triggeringMode: 'respond-to-all' } } } };
    expect(issuePaths(input)).toStrictEqual(['mattermost.channels.town-square.triggeringMode']);
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

  it('should accept a schedule announcing in a declared channel (§4.2)', () => {
    expect($Config.safeParse(scheduled({ 'morning-sweep': schedule({}) })).success).toBe(true);
  });

  it('should refuse a schedule naming a channel nothing declares', () => {
    expect(issuePaths(scheduled({ 'morning-sweep': schedule({ channel: 'nowhere' }) }))).toStrictEqual([
      'agents.mira.schedules.morning-sweep.channel'
    ]);
  });

  it('should refuse a malformed recurrence and an unknown timezone, naming the agent and the handle', () => {
    expect(
      issuePaths(scheduled({ 'morning-sweep': schedule({ recurrence: { at: '25:00', every: 'day' } }) }))
    ).toStrictEqual(['agents.mira.schedules.morning-sweep.recurrence.at']);
    expect(issuePaths(scheduled({ 'morning-sweep': schedule({ timezone: 'Mars/Olympus' }) }))).toStrictEqual([
      'agents.mira.schedules.morning-sweep.timezone'
    ]);
  });

  it('should refuse a schedule handle outside the lowercase-dashed grammar', () => {
    expect($Config.safeParse(scheduled({ 'Morning Sweep': schedule({}) })).success).toBe(false);
  });
});

describe('the committed smoke deployment', () => {
  it('should satisfy the schema the app parses at boot', () => {
    const path = new URL('../../../../../.github/smoke.config.json', import.meta.url);
    const result = $Config.safeParse(JSON.parse(readFileSync(path, 'utf-8')));
    expect(result.error?.issues ?? []).toStrictEqual([]);
  });
});
