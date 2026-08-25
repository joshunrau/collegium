import { createServiceToken } from '@collegium/core/utils';

import type { MailRegistry } from './mail.registry.ts';

/** the mail toolset reaches the registry through this token, so the declaration stays inert (§2) */
export const MAIL_REGISTRY_TOKEN = createServiceToken<MailRegistry>('MAIL_REGISTRY');
