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
    completionTimeLimitMs: 1_200_000,
    turnContextCeilingTokens: 200_000
  },
  display: {
    timezone: 'UTC'
  },
  inference: {
    retry: { backoffMs: 1_000, maxAttempts: 5, maxDelayMs: 30_000 },
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
    lifecycle: true,
    stalls: { longTurnMs: 1_800_000, standingQueueMs: 600_000 }
  },
  providers: {
    deepseek: { baseUrl: 'https://api.deepseek.com' },
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1' }
  },
  turns: {
    actionBudget: 25,
    chainLengthLimit: 200,
    delegationDepthLimit: 10,
    hourlyCeiling: 500
  },
  web: {
    allowPrivateAddresses: false,
    maxBrowserSessions: 4
  }
} as const;

/** the budget is channel history alone: the prompt, tool definitions, and in-turn tool results fill the rest of the turn's ceiling */
export const CONTEXT_BUDGET_CEILING_SHARE = 0.25;

/**
 * §3.8 — the most of a model's window a turn's ceiling may claim, whatever is declared. The
 * remainder is the completion the model has yet to write and the slack a character-ratio estimate
 * owes a tokeniser it is not.
 */
export const TURN_CONTEXT_WINDOW_SHARE = 0.85;
