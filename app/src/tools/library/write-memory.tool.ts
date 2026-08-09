import { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { WRITE_MEMORY_TOOL_NAME } from '@/memory/memory.constants.ts';
import { MemoryService } from '@/memory/memory.service.ts';

type $WriteMemoryArgs = z.infer<typeof $WriteMemoryArgs>;
const $WriteMemoryArgs = z.object({
  body: z.string().min(1).describe('The content to remember'),
  description: z.string().min(1).describe('One line stating when this memory matters')
});

@Injectable()
export class WriteMemoryTool extends Tool({
  description:
    'Save a memory: a one-line description shown to you on every turn, and a body you can read back on demand.',
  name: WRITE_MEMORY_TOOL_NAME,
  parameters: $WriteMemoryArgs,
  timeoutMs: 5000,
  // §3.6 — the single ungated write: gating memory formation would park a turn on a triviality
  variant: 'ungated'
}) {
  constructor(private readonly memoryService: MemoryService) {
    super();
  }

  async execute(args: $WriteMemoryArgs, turn: Tool.TurnScope): Promise<Tool.Result> {
    const written = await this.memoryService.write({
      agentUsername: turn.agentUsername,
      body: args.body,
      description: args.description,
      originPostId: turn.triggeringPostId
    });
    if (!written.success) {
      const { field, length, limit } = written.error;
      return Result.err({
        kind: 'invalid-arguments',
        message: `the ${field} is ${length} characters, over its cap of ${limit}`
      });
    }
    await turn.discloseMemoryWrite({
      body: args.body,
      description: args.description,
      evictedDescriptions: written.value.evictedDescriptions,
      memoryId: written.value.entry.id
    });
    return Result.ok({ text: `memory ${written.value.entry.id} saved` });
  }

  getApprovalRequirements(): Tool.ApprovalRequirements.Ungated {
    return { kind: 'ungated' };
  }

  isRetryable(): false {
    return false;
  }

  /** §3.6 already discloses the body on its own line, so the call line carries only the description */
  renderTraceDetail(args: $WriteMemoryArgs): string {
    return args.description;
  }
}
