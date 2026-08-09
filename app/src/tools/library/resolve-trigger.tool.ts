import { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { RESOLVE_TRIGGER_TOOL_NAME } from '@/triggers/triggers.constants.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';

type $ResolveTriggerArgs = z.infer<typeof $ResolveTriggerArgs>;
const $ResolveTriggerArgs = z.object({
  id: z.string().min(1).describe('The trigger id, exactly as it appears in the announcement post')
});

@Injectable()
export class ResolveTriggerTool extends Tool({
  description: 'Mark a trigger as handled so its outstanding list entry is closed.',
  name: RESOLVE_TRIGGER_TOOL_NAME,
  parameters: $ResolveTriggerArgs,
  timeoutMs: 5000,
  variant: 'ungated'
}) {
  constructor(private readonly triggersService: TriggersService) {
    super();
  }

  async execute(args: $ResolveTriggerArgs, turn: Tool.TurnScope): Promise<Tool.Result> {
    const resolved = await this.triggersService.resolve(args.id, turn.agentUsername);
    if (!resolved.success) {
      // the source's own handling failed, which the agent can act on — unlike an unknown id
      if (resolved.error.kind === 'not-resolvable') {
        return Result.err({ kind: 'invalid-arguments', message: resolved.error.message });
      }
      return Result.err({ kind: 'invalid-arguments', message: `no trigger "${args.id}" is addressed to you` });
    }
    return Result.ok({ text: `trigger ${args.id} resolved` });
  }

  getApprovalRequirements(): Tool.ApprovalRequirements.Ungated {
    return { kind: 'ungated' };
  }

  /** resolving is idempotent, so a transport-level retry cannot double a side effect (§7.2) */
  isRetryable(): true {
    return true;
  }

  renderTraceDetail(args: $ResolveTriggerArgs): string {
    return args.id;
  }
}
