export const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const;

/** ascending severity: the order is load-bearing, since the logger ranks a level by its index here */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type ModelName = (typeof DEEPSEEK_MODELS)[number] | (typeof OPENROUTER_MODELS)[number];

/** the window the provider serving that name offers, keyed by the name its provider is called with */
export const MODEL_CONTEXT_WINDOW_TOKENS = {
  'anthropic/claude-sonnet-5': 1_000_000,
  'deepseek-v4-flash': 1_000_000,
  'deepseek-v4-pro': 1_000_000,
  'deepseek/deepseek-v4-flash': 1_048_576,
  'deepseek/deepseek-v4-pro': 1_048_576
} as const satisfies { readonly [K in ModelName]: number };

export const OPENROUTER_MODELS = [
  'anthropic/claude-sonnet-5',
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-pro'
] as const;
