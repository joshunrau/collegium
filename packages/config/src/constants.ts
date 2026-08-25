/**
 * The shipped defaults, declared once so the Zod schema derives them and fixtures can import the
 * values instead of transcribing them. A default that changes here changes everywhere.
 */
export const CONFIG_DEFAULTS = {
  app: {
    contextBudgetTokens: 8000,
    debounce: { ceilingMs: 15_000, windowMs: 750 },
    enableLifecycleNotifications: true,
    inferenceRetry: { backoffMs: 250, maxAttempts: 3 },
    inferenceTimeoutMs: 120_000,
    logLevel: 'info',
    timezone: 'UTC',
    turnCeilingPerHour: 250
  },
  mattermost: {
    mainChannel: 'town-square',
    systemBotUsername: 'orchestrator'
  },
  models: {
    deepseek: { baseUrl: 'https://api.deepseek.com' },
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1' }
  }
} as const;
