/**
 * The shipped defaults, declared once so the Zod schema derives them and fixtures can import the
 * values instead of transcribing them. A default that changes here changes everywhere. Shaped as
 * config.json is, section for section.
 */
export const CONFIG_DEFAULTS = {
  activation: {
    debounce: { ceilingMs: 15_000, windowMs: 750 },
    foldLimit: 3
  },
  agentDefaults: {
    contextBudgetTokens: 8000
  },
  display: {
    timezone: 'UTC'
  },
  inference: {
    retry: { backoffMs: 250, maxAttempts: 3 },
    timeoutMs: 120_000
  },
  logging: {
    level: 'info'
  },
  mattermost: {
    mainChannel: 'town-square',
    systemBotUsername: 'orchestrator'
  },
  notifications: {
    lifecycle: true
  },
  providers: {
    deepseek: { baseUrl: 'https://api.deepseek.com' },
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1' }
  },
  turns: {
    actionBudget: 10,
    delegationDepthLimit: 10,
    hourlyCeiling: 250
  }
} as const;
