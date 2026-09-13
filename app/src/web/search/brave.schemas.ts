import { z } from 'zod';

export type $BraveWebSearchResponse = z.infer<typeof $BraveWebSearchResponse>;
export const $BraveWebSearchResponse = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          age: z.string().optional(),
          description: z.string().default(''),
          title: z.string(),
          url: z.string()
        })
      )
    })
    .optional()
});

export type $BraveErrorResponse = z.infer<typeof $BraveErrorResponse>;
export const $BraveErrorResponse = z.object({
  error: z.object({
    detail: z.string().optional()
  })
});
