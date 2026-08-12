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
// The env holds where the substrate is and which workspace within it this deployment occupies —
// everything up to and including the team. What lives inside the team is config.json's: which
// channel is the main one, which agents exist, what they may do.
export const $Env = z
  .object({
    APP_HOST: z.string().min(1),
    APP_PORT: $NumberLike.pipe(z.int().nonnegative().max(65_535)),
    APP_PUBLIC_URL: z.url().optional(),
    CONFIG_PATH: z.string().min(1),
    DATABASE_URL: $SqliteFileUrl,
    MATTERMOST_TEAM: z.string().min(1),
    // the websocket address is this one with its scheme rewritten, so anything but http(s) yields a
    // transport that can never connect
    MATTERMOST_URL: z.url({ protocol: /^https?$/ }),
    WORKSPACE_ROOT: z.string().min(1)
  })
  // Where the app binds need not be where it is reached, and a deployment whose Mattermost is a
  // container of its own states APP_PUBLIC_URL. The derivation serves the case where the two agree.
  .transform((env) => ({
    ...env,
    APP_PUBLIC_URL: env.APP_PUBLIC_URL ?? `http://${env.APP_HOST}:${env.APP_PORT}`
  }));
