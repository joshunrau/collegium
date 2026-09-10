import * as path from 'node:path';

export const E2E_RESOURCE_PREFIX = 'collegium-e2e';

export const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');

/** §5.3 — the budget the suites count attempts against; the shipped default is free to move without them */
export const ACTION_BUDGET = 10;
