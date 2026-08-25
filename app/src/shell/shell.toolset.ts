import { implementToolset, SHELL_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import { SHELL_SERVICE_TOKEN } from './shell.tokens.ts';

export const SHELL_TOOLSET = implementToolset(SHELL_TOOLSET_DEF, {
  services: { shell: SHELL_SERVICE_TOKEN },
  tools: {
    run: {
      /** §6.2 — a shell command is never hidden or truncated; one too long to present is refused at the gate */
      approval: (args) => ({
        body: `Run this shell command as this agent's dedicated OS user:\n\n\`\`\`sh\n${args.command}\n\`\`\``,
        presentation: 'verbatim'
      }),
      description: 'Run a shell command on the host as your own dedicated OS user.',
      execute: async (args, context) => {
        const result = await context.shell.run({
          agentUsername: context.turn.agentUsername,
          command: args.command
        });
        if (!result.success) {
          return Result.err({ kind: 'exception', message: result.error.message });
        }
        return Result.ok({ text: result.value.text });
      },
      parameters: z.object({
        command: z.string().min(1).describe('The shell command to run, exactly as it will be presented for approval')
      }),
      // the dedicated user's own `timeout(1)` bounds the command at 60s; this backstops only a wedged `sudo`
      timeoutMs: 75_000,
      traceDetail: (args) => args.command
    }
  }
});
