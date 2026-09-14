import { micromark } from 'micromark';

import { toMarkdown } from '@/web/web.utils.ts';

import { toOutboundMail } from '../mail.utils.ts';
import { MAIL_TEMPLATE_BODY_PLACEHOLDER } from './compose.constants.ts';

import type { OutboundMail } from '../mail.types.ts';
import type { $MailTemplate } from './compose.schemas.ts';

/**
 * With a template, the markdown body is rendered into it, and the plain-text part is that HTML read
 * back as text so a client showing only text still carries the signature.
 */
export function composeOutboundMail(args: OutboundMail, template: $MailTemplate | undefined): OutboundMail {
  const mail = toOutboundMail(args);
  if (template === undefined) {
    return mail;
  }
  // micromark escapes raw HTML by default: a tag the approver read as text must not reach the recipient as markup
  const html = template.replace(MAIL_TEMPLATE_BODY_PLACEHOLDER, () => micromark(mail.body));
  return { ...mail, body: toMarkdown(html), html };
}
