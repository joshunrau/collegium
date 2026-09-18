import { z } from 'zod';

import { TOOL_REF_PATTERN } from './tools.constants.ts';

export type $ToolRef = z.infer<typeof $ToolRef>;
export const $ToolRef = z
  .string()
  .regex(TOOL_REF_PATTERN)
  .describe('A toolset namespace, or one tool by its "namespace::tool" ref');
