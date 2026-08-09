import { z } from 'zod';

import { $$CamelCased } from '@/core/core.schemas.ts';

const $GraphRemovedItem = z.object({
  '@removed': z.object({ reason: z.string().optional() }),
  id: z.string().min(1)
});

const $GraphDeltaMessage = z.object({
  id: z.string().min(1),
  receivedDateTime: z.coerce.date()
});

/** the Entra token endpoint's answer, validated at the perimeter; only the fields consumed are named */
export type $ExchangeTokenResponse = z.infer<typeof $ExchangeTokenResponse>;
export const $ExchangeTokenResponse = $$CamelCased(
  z.object({
    accessToken: z.string().min(1),
    expiresIn: z.number().int().positive()
  })
);

// Microsoft Graph speaks camelCase natively, so the schemas below declare the wire shape as-is
// and `$$CamelCased` has nothing to convert.

export type $GraphRecipient = z.infer<typeof $GraphRecipient>;
export const $GraphRecipient = z.object({
  emailAddress: z.object({
    address: z.string().default(''),
    name: z.string().optional()
  })
});

export type $GraphMessageSummary = z.infer<typeof $GraphMessageSummary>;
export const $GraphMessageSummary = z.object({
  bodyPreview: z.string().default(''),
  conversationId: z.string().optional(),
  from: $GraphRecipient.optional(),
  id: z.string().min(1),
  isRead: z.boolean().default(false),
  receivedDateTime: z.coerce.date(),
  subject: z.string().default('')
});

export type $GraphMessage = z.infer<typeof $GraphMessage>;
export const $GraphMessage = $GraphMessageSummary.extend({
  body: z
    .object({
      content: z.string().default(''),
      contentType: z.enum(['html', 'text']).default('text')
    })
    .optional(),
  ccRecipients: z.array($GraphRecipient).default([]),
  hasAttachments: z.boolean().default(false),
  replyTo: z.array($GraphRecipient).default([]),
  toRecipients: z.array($GraphRecipient).default([])
});

export type $GraphAttachment = z.infer<typeof $GraphAttachment>;
export const $GraphAttachment = z.object({
  contentType: z.string().default('application/octet-stream'),
  name: z.string().default(''),
  size: z.number().int().nonnegative().default(0)
});

export type $GraphMessageSummaryList = z.infer<typeof $GraphMessageSummaryList>;
export const $GraphMessageSummaryList = z.object({ value: z.array($GraphMessageSummary) });

export type $GraphAttachmentList = z.infer<typeof $GraphAttachmentList>;
export const $GraphAttachmentList = z.object({ value: z.array($GraphAttachment) });

/** one page of a delta walk: tombstones and changed messages, with the link that continues or resumes it */
export type $GraphDeltaPage = z.infer<typeof $GraphDeltaPage>;
export const $GraphDeltaPage = z.object({
  '@odata.deltaLink': z.url().optional(),
  '@odata.nextLink': z.url().optional(),
  value: z.array(z.union([$GraphRemovedItem, $GraphDeltaMessage]))
});

/**
 * The adapter's own serialization of where inbound reading has reached — the opaque string in the
 * MailCursor row. The watermark and boundary ids are fixed at first connection: delta reports
 * changes, not arrivals, so an update to pre-connection mail must stay distinguishable from new
 * mail forever. Post-connection re-observations are absorbed by trigger dedupe keys instead.
 */
export type $ExchangeCursor = z.infer<typeof $ExchangeCursor>;
export const $ExchangeCursor = z.object({
  /** ids sharing the watermark instant, so a same-second arrival is still announced */
  boundaryIds: z.array(z.string()),
  /** the delta link Graph handed back — or a mid-round next link while a backlog drains */
  link: z.url(),
  /** receipt instant of the newest message present at first connection; nothing at or before it is new */
  watermark: z.iso.datetime()
});
