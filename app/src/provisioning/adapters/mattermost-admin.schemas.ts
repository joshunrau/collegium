import { z } from 'zod';

/** every created or fetched resource is read for its id alone; nothing here reads the rest */
export type $MattermostIdentified = z.infer<typeof $MattermostIdentified>;
export const $MattermostIdentified = z.object({
  id: z.string().min(1)
});

/** the user lookup alone reads more than the id: `is_bot` is true on bot accounts and may be absent on humans */
export type $MattermostUser = z.infer<typeof $MattermostUser>;
export const $MattermostUser = $MattermostIdentified.extend({
  is_bot: z.boolean().optional()
});

/** a bot's own id is its user_id; `id` on the same payload is the bot record, which addresses nothing */
export type $MattermostBot = z.infer<typeof $MattermostBot>;
export const $MattermostBot = z.object({
  user_id: z.string().min(1)
});

export type $MattermostAccessToken = z.infer<typeof $MattermostAccessToken>;
export const $MattermostAccessToken = z.object({
  token: z.string().min(1)
});

/** `roles` arrives as one space-separated string, e.g. `"system_user system_admin"` */
export type $MattermostRoles = z.infer<typeof $MattermostRoles>;
export const $MattermostRoles = z.object({
  roles: z.string().transform((roles) => roles.split(' '))
});

/**
 * The settings of `/api/v4/config` this deployment cannot run without. A bundled Mattermost is
 * started holding all three; an operator's own server holds whatever they chose, and two of these
 * fail loudly at the first write while the third fails silently, hours later, on a button click.
 */
export type $MattermostServerSettings = z.infer<typeof $MattermostServerSettings>;
export const $MattermostServerSettings = z.object({
  ServiceSettings: z.object({
    /** one space-separated string, e.g. `"app host.docker.internal"` */
    AllowedUntrustedInternalConnections: z.string().transform((hosts) => hosts.split(/\s+/).filter(Boolean)),
    EnableBotAccountCreation: z.boolean(),
    EnableUserAccessTokens: z.boolean()
  })
});
