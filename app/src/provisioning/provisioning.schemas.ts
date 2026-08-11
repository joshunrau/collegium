import { z } from 'zod';

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
  MATTERMOST_ADMIN_EMAIL: z.email(),
  MATTERMOST_ADMIN_PASSWORD: z.string().min(1),
  MATTERMOST_ADMIN_USERNAME: z.string().min(1)
});
