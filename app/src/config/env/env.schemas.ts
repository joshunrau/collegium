import { z } from 'zod';

import { $NumberLike } from '@/core/core.schemas.ts';

export type $Env = z.infer<typeof $Env>;
export const $Env = z
  .object({
    APP_HOST: z.string().min(1),
    APP_PORT: $NumberLike.pipe(z.int().nonnegative().max(65_535)),
    APP_PUBLIC_URL: z.url().optional(),
    CONFIG_PATH: z.string().min(1),
    DATABASE_URL: z.url(),
    WORKSPACE_ROOT: z.string().min(1)
  })
  // Mattermost runs on the same host, so the address the app binds is the address it is reached at
  // and a deployment states it once. Set APP_PUBLIC_URL only where the two genuinely differ — the
  // e2e suite, whose Mattermost is a container and reaches the host under another name.
  .transform((env) => ({
    ...env,
    APP_PUBLIC_URL: env.APP_PUBLIC_URL ?? `http://${env.APP_HOST}:${env.APP_PORT}`
  }));
