import { z } from 'zod';

import { MAIL_TEMPLATE_BODY_PLACEHOLDER } from './compose.constants.ts';

export type $MailTemplate = z.infer<typeof $MailTemplate>;
export const $MailTemplate = z
  .string()
  .refine((template) => template.split(MAIL_TEMPLATE_BODY_PLACEHOLDER).length === 2, {
    message: `must hold ${MAIL_TEMPLATE_BODY_PLACEHOLDER} exactly once`
  })
  .brand<'MailTemplate'>();
