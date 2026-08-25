import { createServiceToken } from '@collegium/core/utils';

import type { AgentRegistry } from './agents.registry.ts';

/** the workspace toolset reads each agent's workspace directory through this token (§4) */
export const AGENT_REGISTRY_TOKEN = createServiceToken<AgentRegistry>('AGENT_REGISTRY');
