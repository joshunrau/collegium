import { createServiceToken } from '@collegium/core/utils';

import type { ShellService } from './shell.service.ts';

/** the shell toolset reaches the service through this token, so the declaration stays inert (§2) */
export const SHELL_SERVICE_TOKEN = createServiceToken<ShellService>('SHELL_SERVICE');
