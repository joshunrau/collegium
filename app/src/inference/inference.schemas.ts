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
    toolCalls: z.array($ToolCall).default([])
  })
});

const $Usage = z.object({
  completionTokens: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative()
});

export type $ChatCompletion = z.infer<typeof $ChatCompletion>;
export const $ChatCompletion = $$CamelCased(
  z.object({
    choices: z.array($Choice).min(1),
    usage: $Usage.optional()
  })
);
