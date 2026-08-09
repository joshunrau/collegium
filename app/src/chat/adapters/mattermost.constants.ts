/**
 * A const object rather than a TS enum: enum members are not assignable to the vendor's raw
 * channel-type literals, so an enum could never meet Mattermost's own types at the seam.
 */
export const MattermostChannelType = {
  /** a direct message between exactly two users */
  Direct: 'D',
  /** a direct message between three or more users */
  Group: 'G',
  /** a public channel, joinable by any member of the team */
  Open: 'O',
  /** a private channel, joinable by invitation only */
  Private: 'P',
  /** the client-side Threads view; never the type of a real channel */
  Threads: 'threads'
} as const;

export type MattermostChannelType = (typeof MattermostChannelType)[keyof typeof MattermostChannelType];
