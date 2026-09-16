import { z } from 'zod';

import { $$CamelCased } from '@/core/core.schemas.ts';
import type { ReasoningDetail } from '@/core/core.types.ts';

const $TokenCount = z.number().int().nonnegative();

const $Usage = z
  .object({
    completionTokens: $TokenCount,
    completionTokensDetails: z.object({ reasoningTokens: $TokenCount.optional() }).nullish(),
    /** what the provider charged, denominated in USD by every provider that reports it at all */
    cost: z.number().nonnegative().optional(),
    promptCacheHitTokens: $TokenCount.optional(),
    promptTokens: $TokenCount,
    promptTokensDetails: z.object({ cachedTokens: $TokenCount.optional() }).nullish()
  })
  .transform(
    ({ completionTokens, completionTokensDetails, cost, promptCacheHitTokens, promptTokens, promptTokensDetails }) => ({
      cachedPromptTokens: promptTokensDetails?.cachedTokens ?? promptCacheHitTokens,
      completionTokens,
      costUsd: cost,
      promptTokens,
      reasoningTokens: completionTokensDetails?.reasoningTokens
    })
  );

/** loose on purpose: a block echoes back with every field it came with, named here or not (§3.12) */
export const $ReasoningDetail: z.ZodType<ReasoningDetail> = z.looseObject({
  data: z.string().optional(),
  index: z.number().int().optional(),
  signature: z.string().nullish(),
  summary: z.string().optional(),
  text: z.string().optional()
});

export type $ToolCallDelta = z.infer<typeof $ToolCallDelta>;
export const $ToolCallDelta = z.object({
  function: z.object({ arguments: z.string().nullish(), name: z.string().nullish() }).nullish(),
  id: z.string().nullish(),
  index: z.number().int().nonnegative().optional()
});

export type $CompletionDelta = z.infer<typeof $CompletionDelta>;
export const $CompletionDelta = z.object({
  content: z.string().nullish(),
  reasoning: z.string().nullish(),
  reasoning_content: z.string().nullish(),
  reasoning_details: z.array($ReasoningDetail).nullish(),
  tool_calls: z.array($ToolCallDelta).nullish()
});

/**
 * One `data:` event of a streamed completion, read by its wire keys so a reasoning block is
 * echoed back as it came; usage alone is camel-cased, being ours to read and nobody's to return.
 */
export type $CompletionChunk = z.infer<typeof $CompletionChunk>;
export const $CompletionChunk = z.object({
  choices: z.array(z.object({ delta: $CompletionDelta.nullish(), finish_reason: z.string().nullish() })).nullish(),
  error: z.object({ code: z.union([z.number().int(), z.string()]).nullish(), message: z.string() }).nullish(),
  usage: $$CamelCased($Usage).nullish()
});
