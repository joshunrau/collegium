import { $NumberLike } from '@collegium/core/common';
import { z } from 'zod';

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
    APP_HOST: z
      .string()
      .min(1)
      .describe(
        'The address the app binds to. Under Compose this is `0.0.0.0`, reachable on the Compose network alone: the port is not published to the host.'
      ),
    APP_PORT: $NumberLike
      .pipe(z.int().nonnegative().max(65_535))
      .describe('The port the app listens on, and the port Mattermost and the trigger endpoints are reached through.'),
    APP_PUBLIC_URL: z
      .url()
      .optional()
      .describe(
        'The address Mattermost calls back on to deliver approval decisions, slash commands, and triggers. Defaults to the bind address, which is right only when the app is reached where it binds; a deployment whose Mattermost is a container of its own must state this.'
      ),
    CONFIG_PATH: z
      .string()
      .min(1)
      .describe('Path to `config.json`, the declaration of the agents, channels, and grants this deployment runs.'),
    DATABASE_URL: $SqliteFileUrl.describe(
      'A `file:` URL naming the SQLite store, absolute and without a host — `file:///data/prod.db`. Its parent directory is created and taken over on boot.'
    ),
    MATTERMOST_TEAM: z
      .string()
      .min(1)
      .describe(
        'The team this deployment occupies, by handle — the name in its URL. Created on first start if absent.'
      ),
    // the websocket address is this one with its scheme rewritten, so anything but http(s) yields a
    // transport that can never connect
    MATTERMOST_URL: z
      .url({ protocol: /^https?$/ })
      .describe(
        'Where the app reaches Mattermost, over http or https. Not where you reach it — under Compose these differ.'
      ),
    WORKSPACE_ROOT: z
      .string()
      .min(1)
      .describe(
        'The directory holding one workspace per agent. Everything an agent writes through a tool is confined beneath its own.'
      )
  })
  .transform((env) => ({
    ...env,
    APP_PUBLIC_URL: env.APP_PUBLIC_URL ?? `http://${env.APP_HOST}:${env.APP_PORT}`
  }));

/**
 * The administrator the provisioner acts as. Deliberately absent from `$Env`, which the running app
 * parses: these reach the provisioning subprocess and no further, and the root prologue drops them
 * from the environment before the app itself is imported.
 *
 * Creating bots, minting their tokens, and creating a team are all system-level in Mattermost, so
 * nothing narrower than an administrator can provision. On a server with no users yet the account is
 * created here, and Mattermost grants system admin to the first user of a fresh install.
 */
export type $ProvisioningEnv = z.infer<typeof $ProvisioningEnv>;
export const $ProvisioningEnv = z.object({
  MATTERMOST_ADMIN_EMAIL: z
    .email()
    .describe(
      'Email of the Mattermost administrator provisioning signs in as. On a first start the account is created with it.'
    ),
  MATTERMOST_ADMIN_PASSWORD: z.string().min(1).describe('Password of that administrator.'),
  MATTERMOST_ADMIN_USERNAME: z
    .string()
    .min(1)
    .describe('Username of that administrator — also how you log in to Mattermost yourself.')
});
