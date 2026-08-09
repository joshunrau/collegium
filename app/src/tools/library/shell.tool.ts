import { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { SHELL_TOOL_NAME } from '@/shell/shell.constants.ts';
import { ShellService } from '@/shell/shell.service.ts';

type $ShellArgs = z.infer<typeof $ShellArgs>;
const $ShellArgs = z.object({
  command: z.string().min(1).describe('The shell command to run, exactly as it will be presented for approval')
});

@Injectable()
export class ShellTool extends Tool({
  description: 'Run a shell command on the host as your own dedicated OS user.',
  name: SHELL_TOOL_NAME,
  parameters: $ShellArgs,
  // the dedicated user's own `timeout(1)` bounds the command at 60s; this backstops only a wedged `sudo`
  timeoutMs: 75_000,
  variant: 'gated'
}) {
  constructor(private readonly shellService: ShellService) {
    super();
  }

  async execute(args: $ShellArgs, turn: Tool.TurnScope): Promise<Tool.Result> {
    const result = await this.shellService.run({ agentUsername: turn.agentUsername, command: args.command });
    if (!result.success) {
      return Result.err({ kind: 'exception', message: result.error.message });
    }
    return Result.ok({ text: result.value.text });
  }

  /** §6.2 — a shell command is never hidden or truncated; one too long to present is refused at the gate */
  getApprovalRequirements({ command }: $ShellArgs): Tool.ApprovalRequirements.Gated {
    return {
      kind: 'gated',
      payload: {
        body: `Run this shell command as this agent's dedicated OS user:\n\n\`\`\`sh\n${command}\n\`\`\``,
        presentation: 'verbatim'
      }
    };
  }

  /** a shell command is a side effect with no undo; a timeout leaves us unable to say whether it landed (§7.2) */
  isRetryable(): false {
    return false;
  }

  renderTraceDetail({ command }: $ShellArgs): string {
    return command;
  }
}
