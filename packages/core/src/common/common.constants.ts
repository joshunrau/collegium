export const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const;

/** ascending severity: the order is load-bearing, since the logger ranks a level by its index here */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export const OPENROUTER_MODELS = ['anthropic/claude-sonnet-5', 'deepseek-v4-flash', 'deepseek-v4-pro'] as const;
