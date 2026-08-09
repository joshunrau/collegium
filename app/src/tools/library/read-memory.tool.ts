import { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { READ_MEMORY_TOOL_NAME } from '@/memory/memory.constants.ts';
import { MemoryService } from '@/memory/memory.service.ts';

type $ReadMemoryArgs = z.infer<typeof $ReadMemoryArgs>;
const $ReadMemoryArgs = z.object({
  id: z.string().min(1).describe('The id of the memory entry, as listed beside its description')
});

@Injectable()
export class ReadMemoryTool extends Tool({
  description: 'Read the full body of one of your memories.',
  name: READ_MEMORY_TOOL_NAME,
  parameters: $ReadMemoryArgs,
  timeoutMs: 5000,
  variant: 'ungated'
}) {
  constructor(private readonly memoryService: MemoryService) {
    super();
  }

  async execute(args: $ReadMemoryArgs, turn: Tool.TurnScope): Promise<Tool.Result> {
    const memory = await this.memoryService.read(turn.agentUsername, args.id);
    if (!memory.success) {
      return Result.err({ kind: 'invalid-arguments', message: `no memory entry with id "${memory.error.id}" exists` });
    }
    return Result.ok({ text: memory.value.body });
  }

  getApprovalRequirements(): Tool.ApprovalRequirements.Ungated {
    return { kind: 'ungated' };
  }

  isRetryable(): true {
    return true;
  }

  renderTraceDetail(args: $ReadMemoryArgs): string {
    return args.id;
  }
}
