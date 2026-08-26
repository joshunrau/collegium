import * as path from 'node:path';

import type { $Env } from '@collegium/config';

import { PROJECT_ROOT } from './constants.ts';

/**
 * Every variable a Collegium process requires, as the strings it is handed. Annotating each
 * harness's literal with this is what makes a new variable a compile error here rather than a boot
 * failure in whichever suite happens to build its environment by hand.
 */
export type HarnessEnv = { [Key in keyof $Env]: string };

/** the repository's own plugin directory, which is what a deployment mounts */
export const REPOSITORY_PLUGINS_ROOT = path.resolve(PROJECT_ROOT, '..', 'plugins');
