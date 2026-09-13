import { z } from 'zod';

import { $$CamelCased, $$JSONEncoded } from '@/core/core.schemas.ts';

const $ToolCall = z.object({
  function: z.object({
    arguments: $$JSONEncoded(z.unknown()),
    name: z.string().min(1)
  }),
  id: z.string().min(1)
});

const $Choice = z.object({
  message: z.object({
    content: z.string().nullable().default(null),
    reasoningContent: z.string().nullable().default(null),
    toolCalls: z.array($ToolCall).default([])
  })
});

const $TokenCount = z.number().int().nonnegative();

const $Usage = z
  .object({
    completionTokens: $TokenCount,
    completionTokensDetails: z.object({ reasoningTokens: $TokenCount.optional() }).nullish(),
    promptTokens: $TokenCount,
    promptTokensDetails: z.object({ cachedTokens: $TokenCount.optional() }).nullish()
  })
  .transform(({ completionTokens, completionTokensDetails, promptTokens, promptTokensDetails }) => ({
    cachedPromptTokens: promptTokensDetails?.cachedTokens,
    completionTokens,
    promptTokens,
    reasoningTokens: completionTokensDetails?.reasoningTokens
  }));

export type $ChatCompletion = z.infer<typeof $ChatCompletion>;
export const $ChatCompletion = $$CamelCased(
  z.object({
    choices: z.array($Choice).min(1),
    usage: $Usage.optional()
  })
);
