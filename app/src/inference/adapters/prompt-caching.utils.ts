import { createHash } from 'node:crypto';

import { DEEPSEEK_MODELS } from '@collegium/core/common';
import { match, P } from 'ts-pattern';

import type { CompletionRequest } from '../inference.types.ts';

function cachingPolicy(model: CompletionRequest['model']['name']) {
  return match(model)
    .with(P.union(...DEEPSEEK_MODELS), () => 'deepseek' as const)
    .with(P.string.startsWith('anthropic/'), P.string.startsWith('~anthropic/'), () => 'anthropic' as const)
    .with(P.string.startsWith('openai/'), P.string.startsWith('~openai/'), () => 'openai' as const)
    .with(
      P.string.startsWith('deepseek/'),
      P.string.startsWith('~deepseek/'),
      P.string.startsWith('z-ai/'),
      () => 'automatic' as const
    )
    .exhaustive();
}

export function toPromptCaching(request: CompletionRequest) {
  const policy = cachingPolicy(request.model.name);
  const key = createHash('sha256').update(request.cacheKey).digest('hex');
  const cacheControl = { type: 'ephemeral' } as const;
  const breakpoint = match(policy)
    .with('anthropic', () => ({ cache_control: cacheControl }))
    .with('openai', () => ({ prompt_cache_breakpoint: { mode: 'explicit' } as const }))
    .otherwise(() => undefined);
  const content = breakpoint
    ? [request.systemPrompt]
        .filter((text) => text !== '')
        .map((text) => ({ text, type: 'text' as const, ...breakpoint }))
    : request.systemPrompt;
  return {
    options: {
      ...(policy !== 'deepseek' && { session_id: key }),
      ...(policy === 'anthropic' && { cache_control: cacheControl }),
      ...(policy === 'openai' && {
        prompt_cache_key: key,
        prompt_cache_options: { mode: 'implicit', ttl: '30m' } as const
      })
    },
    systemMessage: { content, role: 'system' as const }
  };
}
