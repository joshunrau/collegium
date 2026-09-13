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
    actionBudget: 25,
    delegationDepthLimit: 10,
    hourlyCeiling: 500
  }
} as const;

/** the budget is channel history alone: the prompt, tool definitions, and in-turn tool results fill the rest of the window */
export const CONTEXT_BUDGET_WINDOW_SHARE = 0.25;
