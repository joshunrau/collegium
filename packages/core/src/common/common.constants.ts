export const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const;

/** DeepSeek's own vocabulary for `thinking.reasoning_effort`; `none` turns thinking off */
export const DEEPSEEK_REASONING_EFFORTS = ['none', 'low', 'high', 'max'] as const;

/** OpenRouter's unified `reasoning.effort` vocabulary, which OpenRouter maps onto what the model behind it supports */
export const OPENROUTER_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/** ascending severity: the order is load-bearing, since the logger ranks a level by its index here */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type ModelName = (typeof DEEPSEEK_MODELS)[number] | (typeof OPENROUTER_MODELS)[number];

/** the window the provider serving that name offers, keyed by the name its provider is called with */
export const MODEL_CONTEXT_WINDOW_TOKENS = {
  'anthropic/claude-fable-5.1': 1_000_000,
  'anthropic/claude-opus-5': 1_000_000,
  'anthropic/claude-sonnet-5': 1_000_000,
  'deepseek-v4-flash': 1_000_000,
  'deepseek-v4-pro': 1_000_000,
  'deepseek/deepseek-v4-flash': 1_048_576,
  'deepseek/deepseek-v4-pro': 1_048_576,
  'deepseek/deepseek-v4.1-flash': 1_048_576,
  'openai/gpt-5.6-luna': 1_050_000,
  'openai/gpt-5.6-luna-pro': 1_050_000,
  'openai/gpt-5.6-sol': 1_050_000,
  'openai/gpt-5.6-sol-pro': 1_050_000,
  'openai/gpt-5.6-terra': 1_050_000,
  'openai/gpt-5.6-terra-pro': 1_050_000,
  'openai/gpt-6-astra': 1_050_000,
  'z-ai/glm-5.3': 1_310_720,
  'z-ai/glm-5.3-flash': 1_310_720,
  '~anthropic/claude-fable-latest': 1_000_000,
  '~anthropic/claude-opus-latest': 1_000_000,
  '~anthropic/claude-sonnet-latest': 1_000_000,
  '~deepseek/deepseek-flash-latest': 1_048_576,
  '~deepseek/deepseek-pro-latest': 1_048_576,
  '~openai/gpt-astra-latest': 1_050_000,
  '~openai/gpt-luna-latest': 1_050_000,
  '~openai/gpt-sol-latest': 1_050_000,
  '~openai/gpt-terra-latest': 1_050_000
} as const satisfies { readonly [K in ModelName]: number };

/** a `~` prefix is OpenRouter's own, marking a name that redirects to the current model of that family */
export const OPENROUTER_MODELS = [
  'anthropic/claude-fable-5.1',
  'anthropic/claude-opus-5',
  'anthropic/claude-sonnet-5',
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4.1-flash',
  'openai/gpt-5.6-luna',
  'openai/gpt-5.6-luna-pro',
  'openai/gpt-5.6-sol',
  'openai/gpt-5.6-sol-pro',
  'openai/gpt-5.6-terra',
  'openai/gpt-5.6-terra-pro',
  'openai/gpt-6-astra',
  'z-ai/glm-5.3',
  'z-ai/glm-5.3-flash',
  '~anthropic/claude-fable-latest',
  '~anthropic/claude-opus-latest',
  '~anthropic/claude-sonnet-latest',
  '~deepseek/deepseek-flash-latest',
  '~deepseek/deepseek-pro-latest',
  '~openai/gpt-astra-latest',
  '~openai/gpt-luna-latest',
  '~openai/gpt-sol-latest',
  '~openai/gpt-terra-latest'
] as const;
