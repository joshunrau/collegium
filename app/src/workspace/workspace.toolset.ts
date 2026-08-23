import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { defineToolset } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import { AGENT_REGISTRY_TOKEN } from '@/agents/agents.tokens.ts';

import { resolveWorkspacePath } from './workspace.utils.ts';

export const WORKSPACE_TOOLSET = defineToolset({
  name: 'workspace',
  services: { agents: AGENT_REGISTRY_TOKEN },
  tools: {
    write: {
      approval: (args) => ({
        body: `Write to \`${args.path}\`:\n\n\`\`\`\n${args.content}\n\`\`\``,
        presentation: 'collapse'
      }),
      description: 'Write a text file inside your workspace directory. Parent directories are created as needed.',
      execute: async (args, context) => {
        const profile = context.agents.get(context.turn.agentUsername);
        if (!profile) {
          return Result.err({
            kind: 'exception',
            message: `no agent is registered as "${context.turn.agentUsername}"`
          });
        }
        await fs.promises.mkdir(profile.workspaceDir, { mode: 0o700, recursive: true });
        const resolved = resolveWorkspacePath(profile.workspaceDir, args.path);
        if (!resolved.success) {
          return resolved;
        }
        await fs.promises.mkdir(path.dirname(resolved.value), { recursive: true });
        // temp file beside the target, then rename — a crash mid-write cannot leave a half file
        const staging = path.join(
          path.dirname(resolved.value),
          `.${path.basename(resolved.value)}.${randomUUID()}.tmp`
        );
        await fs.promises.writeFile(staging, args.content, 'utf8');
        await fs.promises.rename(staging, resolved.value);
        return Result.ok({ text: `wrote ${args.path} (${Buffer.byteLength(args.content, 'utf8')} bytes)` });
      },
      parameters: z.object({
        content: z.string().describe('The full content the file will hold'),
        path: z
          .string()
          .min(1)
          .describe('Where to write, relative to your workspace; absolute paths and traversal are rejected')
      }),
      timeoutMs: 10_000,
      /** the path and the size; the content itself is in the approval payload and in `/trace` */
      traceDetail: (args) => `${args.path} (${Buffer.byteLength(args.content, 'utf8')} bytes)`
    }
  }
});
