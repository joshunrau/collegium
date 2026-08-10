import { z } from 'zod';

import { $NumberLike } from '@/core/core.schemas.ts';

/**
 * The store's location, and the one env value the root prologue turns into a filesystem path it
 * then owns recursively. WHATWG normalization hands a *relative* `file:` URL — Prisma's own
 * documented `file:./dev.db` — an absolute pathname directly beneath the filesystem root, so the
 * path is settled on the raw string, before normalization can invent one. A host is refused for
 * the same reason: `fileURLToPath` cannot resolve one, and `file://data/prod.db` reads as a
 * directory named `data` to everyone except the URL parser.
 */
const $SqliteFileUrl = z
  .url({ hostname: /^$/, protocol: /^file$/ })
  .refine(
    (value) => value.slice(value.indexOf(':') + 1).startsWith('/'),
    'must name an absolute path, e.g. file:///var/lib/collegium.db'
  );

export type $Env = z.infer<typeof $Env>;
export const $Env = z
  .object({
    APP_HOST: z.string().min(1),
    APP_PORT: $NumberLike.pipe(z.int().nonnegative().max(65_535)),
    APP_PUBLIC_URL: z.url().optional(),
    CONFIG_PATH: z.string().min(1),
    DATABASE_URL: $SqliteFileUrl,
    WORKSPACE_ROOT: z.string().min(1)
  })
  // Mattermost runs on the same host, so the address the app binds is the address it is reached at
  // and a deployment states it once. Set APP_PUBLIC_URL only where the two genuinely differ — the
  // e2e suite, whose Mattermost is a container and reaches the host under another name.
  .transform((env) => ({
    ...env,
    APP_PUBLIC_URL: env.APP_PUBLIC_URL ?? `http://${env.APP_HOST}:${env.APP_PORT}`
  }));
