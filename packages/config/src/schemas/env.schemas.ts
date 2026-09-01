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

/**
 * A variable an operator may leave blank. Compose delivers one left empty in `.env` as an empty
 * string rather than dropping it, and every variable this wraps is absent-or-set: an empty value is
 * absence, or `.env.template` could not list a variable it does not want set.
 */
const $$Blankable = <TSchema extends z.ZodType>(schema: TSchema) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** the three that must arrive together, and mean nothing one at a time */
const PASSWORD_KEYS = ['MATTERMOST_ADMIN_EMAIL', 'MATTERMOST_ADMIN_PASSWORD', 'MATTERMOST_ADMIN_USERNAME'] as const;

const $AdminEnv = z.object({
  MATTERMOST_ADMIN_EMAIL: $$Blankable(z.email()).describe(
    'Email of the administrator provisioning signs in as, and creates the account with on a Mattermost that has no users yet. Unread when a token is given.'
  ),
  MATTERMOST_ADMIN_PASSWORD: $$Blankable(z.string()).describe('Password of that administrator.'),
  MATTERMOST_ADMIN_TOKEN: $$Blankable(z.string()).describe(
    'A personal access token belonging to a system administrator that already exists, given in place of the three variables above. The only credential a Mattermost server someone else runs should be provisioned with: it creates no account, and it is what an administrator with MFA enabled can offer, since Mattermost refuses those a password login over the API.'
  ),
  MATTERMOST_ADMIN_USERNAME: $$Blankable(z.string()).describe(
    'Username of that administrator — also how you log in to Mattermost yourself.'
  )
});

function resolveAdminCredentials(env: z.infer<typeof $AdminEnv>, issues: z.core.$ZodRawIssue[]): AdminCredentials {
  if (env.MATTERMOST_ADMIN_TOKEN !== undefined) {
    const conflicting = PASSWORD_KEYS.filter((key) => env[key] !== undefined);
    if (conflicting.length > 0) {
      issues.push({
        code: 'custom',
        input: env,
        message: `MATTERMOST_ADMIN_TOKEN already names an administrator; leave ${conflicting.join(', ')} unset`,
        path: ['MATTERMOST_ADMIN_TOKEN']
      });
    }
    return { kind: 'token', token: env.MATTERMOST_ADMIN_TOKEN };
  }
  const missing = PASSWORD_KEYS.filter((key) => env[key] === undefined);
  if (missing.length > 0) {
    issues.push({
      code: 'custom',
      input: env,
      message: `set MATTERMOST_ADMIN_TOKEN to provision as an administrator that already exists, or ${missing.join(', ')} to sign in as one`,
      path: ['MATTERMOST_ADMIN_TOKEN']
    });
  }
  // the issue above fails the parse, so these stand in for values no caller ever reads
  return {
    email: env.MATTERMOST_ADMIN_EMAIL ?? '',
    kind: 'password',
    password: env.MATTERMOST_ADMIN_PASSWORD ?? '',
    username: env.MATTERMOST_ADMIN_USERNAME ?? ''
  };
}

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
        'The address the app binds to. Under Compose this is `0.0.0.0`, and the port is published on the loopback alone unless `APP_BIND_HOST` widens it.'
      ),
    APP_PORT: $NumberLike
      .pipe(z.int().nonnegative().max(65_535))
      .describe('The port the app listens on, and the port Mattermost and the trigger endpoints are reached through.'),
    APP_PUBLIC_URL: z
      .url()
      .optional()
      .describe(
        'The address Mattermost calls back on to deliver approval decisions, slash commands, and triggers. Defaults to the bind address, which is right only when the app is reached where it binds; a deployment whose Mattermost is a container of its own — or a server elsewhere — must state this.'
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
    PLUGINS_ROOT: z
      .string()
      .min(1)
      .describe(
        'The directory holding one plugin per subdirectory, each named for the plugin it holds. Mounted read-only: a plugin is code the operator installs, and nothing the framework runs writes here.'
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
 * The administrator the provisioner acts as, for the life of the provisioning process alone. The
 * two modes differ in what they may bring into being: a token names an administrator that already
 * exists and creates no account, which is the only thing a server someone else runs should be
 * handed; a password may create the administrator it names, because a fresh Mattermost has no
 * account to sign in as and grants system admin to the first user of an empty install.
 */
export type AdminCredentials =
  | { readonly email: string; readonly kind: 'password'; readonly password: string; readonly username: string }
  | { readonly kind: 'token'; readonly token: string };

/**
 * Deliberately absent from `$Env`, which the running app parses: these reach the provisioning
 * subprocess and no further, and the root prologue drops them from the environment before the app
 * itself is imported.
 *
 * Creating bots, minting their tokens, and creating a team are all system-level in Mattermost, so
 * nothing narrower than an administrator can provision.
 */
export const $ProvisioningEnv = $AdminEnv.transform((env, ctx) => resolveAdminCredentials(env, ctx.issues));
