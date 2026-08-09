import { z } from 'zod';

import { $$CamelCased, $$JSONEncoded } from '@/core/core.schemas.ts';

import { MattermostChannelType } from './mattermost.constants.ts';

// `props` is deliberately unparsed: real posts carry arbitrary shapes there (integration
// attachments, client flags), nothing here reads it, and a strict schema would discard the post
const $MattermostPostFields = z.object({
  channelId: z.string().min(1),
  createAt: z.number().int().nonnegative(),
  id: z.string().min(1),
  message: z.string(),
  // empty on a post authored by a user or bot; a "system_*" tag on channel events such as joins and leaves
  type: z.string()
});

const $MattermostPost = $$CamelCased($MattermostPostFields);

// Mattermost sends "" rather than omitting a field that does not apply
const $$EmptyAsAbsent = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

// the channel and user land in `broadcast` or in `data` depending on who the event was sent to,
// so both halves parse loose and the pair is checked as a whole
const $MembershipEventSides = z
  .object({
    broadcast: $$CamelCased(z.object({ channelId: $$EmptyAsAbsent, userId: $$EmptyAsAbsent })),
    data: $$CamelCased(z.object({ channelId: $$EmptyAsAbsent, userId: $$EmptyAsAbsent }))
  })
  .transform(({ broadcast, data }, ctx) => {
    const channelId = data.channelId ?? broadcast.channelId;
    const userId = data.userId ?? broadcast.userId;
    if (channelId === undefined || userId === undefined) {
      ctx.addIssue('must name a channel and a user between broadcast and data');
      return z.NEVER;
    }
    return { channelId, userId };
  });

export type $MattermostPostedEventMessage = z.infer<typeof $MattermostPostedEventMessage>;
export const $MattermostPostedEventMessage = z.object({
  data: $$CamelCased(
    z.object({
      channelType: z.enum(MattermostChannelType),
      post: $$JSONEncoded($MattermostPost),
      senderName: z.string().min(1)
    })
  ),
  event: z.literal('posted')
});

export type $MattermostUserAddedEventMessage = z.infer<typeof $MattermostUserAddedEventMessage>;
export const $MattermostUserAddedEventMessage = z.object({ event: z.literal('user_added') }).and($MembershipEventSides);

export type $MattermostUserRemovedEventMessage = z.infer<typeof $MattermostUserRemovedEventMessage>;
export const $MattermostUserRemovedEventMessage = z
  .object({ event: z.literal('user_removed') })
  .and($MembershipEventSides);

export type $MattermostRestPost = z.infer<typeof $MattermostRestPost>;
export const $MattermostRestPost = $$CamelCased(
  $MattermostPostFields.extend({
    // an edited post leaves a history row behind that names its original — not a real post
    originalId: z.string().default(''),
    userId: z.string().min(1)
  })
);

export type $MattermostPostList = z.infer<typeof $MattermostPostList>;
export const $MattermostPostList = z.object({
  order: z.array(z.string()),
  posts: z.record(z.string(), $MattermostRestPost)
});

export type $MattermostChannel = z.infer<typeof $MattermostChannel>;
export const $MattermostChannel = z.object({
  id: z.string().min(1),
  // empty for direct and group channels, which belong to no team
  team_id: z.string().default(''),
  type: z.enum(MattermostChannelType)
});

export type $MattermostSlashCommand = z.infer<typeof $MattermostSlashCommand>;
export const $MattermostSlashCommand = $$CamelCased(
  z.object({
    autoComplete: z.boolean().default(false),
    autoCompleteHint: z.string().default(''),
    creatorId: z.string().min(1),
    description: z.string().default(''),
    displayName: z.string().default(''),
    id: z.string().min(1),
    method: z.string().default(''),
    trigger: z.string().min(1),
    url: z.string()
  })
);

export type $MattermostUserProfile = z.infer<typeof $MattermostUserProfile>;
export const $MattermostUserProfile = z.object({
  id: z.string().min(1),
  is_bot: z.boolean().default(false),
  username: z.string().min(1)
});

export type $MattermostTeam = z.infer<typeof $MattermostTeam>;
export const $MattermostTeam = z.object({
  id: z.string().min(1)
});

// the client config arrives as an all-string map; only the one field we read is declared and coerced
export type $MattermostClientConfig = z.infer<typeof $MattermostClientConfig>;
export const $MattermostClientConfig = z.object({
  MaxPostSize: z.coerce.number().int().positive()
});

export type $MattermostCreatedPost = z.infer<typeof $MattermostCreatedPost>;
export const $MattermostCreatedPost = $$CamelCased(
  z.object({
    createAt: z.number().int().nonnegative(),
    id: z.string().min(1)
  })
);

export type $MattermostFileUpload = z.infer<typeof $MattermostFileUpload>;
export const $MattermostFileUpload = $$CamelCased(
  z.object({
    fileInfos: z.array($$CamelCased(z.object({ id: z.string().min(1) })))
  })
);
