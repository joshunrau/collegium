import { replaySubjectWhenLong } from '@collegium/core/tools';
import { implementToolset, SHELL_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import { AGENT_REGISTRY_TOKEN } from '@/agents/agents.tokens.ts';
import { fenceCodeBlock } from '@/utils/markdown.utils.ts';

import { SHELL_SERVICE_TOKEN } from './shell.tokens.ts';

export const SHELL_TOOLSET = implementToolset(SHELL_TOOLSET_DEF, {
  services: { agents: AGENT_REGISTRY_TOKEN, shell: SHELL_SERVICE_TOKEN },
  tools: {
    run: {
      /** §6.2 — a shell command is never hidden or truncated; one too long to present is refused at the gate */
      approval: (args) => ({
        body: `Run this shell command as this agent's dedicated OS user:\n\n${fenceCodeBlock(args.command, 'sh')}`,
        presentation: 'verbatim'
      }),
      description: 'Run a shell command on the host as your own dedicated OS user.',
      execute: async (args, context) => {
        const profile = context.agents.get(context.turn.agentUsername);
        if (!profile) {
          return Result.err({
            kind: 'exception',
            message: `no agent is registered as "${context.turn.agentUsername}"`
          });
        }
        const result = await context.shell.run({ command: args.command, profile });
        if (!result.success) {
          return Result.err({ kind: 'exception', message: result.error.message });
        }
        const replaySubject = replaySubjectWhenLong('shell output', result.value.text);
        return Result.ok({ text: result.value.text, ...(replaySubject !== undefined && { replaySubject }) });
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
