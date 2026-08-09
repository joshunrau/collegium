import { glob } from 'astro/loaders';
import { defineCollection } from 'astro:content';
import { z } from 'zod';

const docs = defineCollection({
  loader: glob({ base: './content/docs', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    description: z.string().optional(),
    icon: z.string().optional(),
    title: z.string()
  })
});

const meta = defineCollection({
  loader: glob({ base: './content/docs', pattern: '**/*.{json,yaml}' }),
  schema: z.object({
    description: z.string().optional(),
    icon: z.string().optional(),
    pages: z.array(z.string()).optional(),
    title: z.string().optional()
  })
});

export const collections = {
  docs,
  meta
};
