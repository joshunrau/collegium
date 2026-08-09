import { z } from 'zod';

/**
 * The adapter's own serialization of where inbound reading has reached — the opaque string in the
 * MailCursor row. UIDs are ordinal within one mailbox generation, so the watermark is simply the
 * next unseen UID; a generation change (UIDVALIDITY) invalidates every UID and ref at once.
 */
export type $ImapCursor = z.infer<typeof $ImapCursor>;
export const $ImapCursor = z.object({
  uidNext: z.number().int().nonnegative(),
  uidValidity: z.string().min(1)
});
