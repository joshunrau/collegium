import * as fs from 'node:fs';
import * as path from 'node:path';

import { describeReplaySubject, replaySubjectWhenLong } from '@collegium/core/tools';
import type { ToolFailure, ToolOutput, ToolTurnScope } from '@collegium/core/tools';
import { implementToolset, WORKSPACE_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import type { AgentRegistry } from '@/agents/agents.registry.ts';
import { AGENT_REGISTRY_TOKEN } from '@/agents/agents.tokens.ts';
import { fenceCodeBlock, renderCodeSpan } from '@/utils/markdown.utils.ts';

import { findEntries, grepFiles, listDirectory, readLines, statEntry } from './reads/reads.utils.ts';
import { GREP_DEFAULT_MATCHES, GREP_MAX_MATCHES, WALK_DEFAULT_DEPTH, WALK_MAX_DEPTH } from './workspace.constants.ts';
import { resolveWorkspacePath, writeFileWhole } from './workspace.utils.ts';

import type { ResolvedPath } from './reads/reads.utils.ts';

const $RelativePath = z
  .string()
  .min(1)
  .describe('A path relative to your workspace directory; absolute paths and traversal are rejected');

/**
 * The one place every tool in this toolset — the five reads and the write alike — crosses into the
 * filesystem, so §6.1's confinement stays a single boundary rather than six that must agree.
 */
async function resolveTarget(
  context: { readonly agents: AgentRegistry; readonly turn: ToolTurnScope },
  requested: string
): Promise<Result<ResolvedPath, ToolFailure.Exception | ToolFailure.InvalidArguments>> {
  const profile = context.agents.get(context.turn.agentUsername);
  if (!profile) {
    return Result.err({
      kind: 'exception',
      message: `no agent is registered as "${context.turn.agentUsername}"`
    });
  }
  await fs.promises.mkdir(profile.workspaceDir, { mode: 0o700, recursive: true });
  const resolved = resolveWorkspacePath(profile.workspaceDir, requested);
  if (!resolved.success) {
    return resolved;
  }
  return Result.ok({ absolute: resolved.value, relative: path.normalize(requested) });
}

/** the terminating newline ends the last line rather than starting another, so exactly one is dropped and never more */
function stripOneTerminator(content: string): string {
  return content.endsWith('\n') ? content.slice(0, -1) : content;
}

function toOutput(subject: string, text: string): ToolOutput {
  const replaySubject = replaySubjectWhenLong(subject, text);
  return { text, ...(replaySubject !== undefined && { replaySubject }) };
}

/**
 * §3.4 — the reads are ungated because they take typed arguments rather than a command string: the
 * confinement that bounds a write bounds a read of the same directory, and there is nothing to
 * classify. Deliberately absent, and to be refused when asked for: an `operation` enum, `head` and
 * `tail` (a line range covers both), and `delete` or `move` (a write belongs under `approval`).
 */
export const WORKSPACE_TOOLSET = implementToolset(WORKSPACE_TOOLSET_DEF, {
  services: { agents: AGENT_REGISTRY_TOKEN },
  tools: {
    find: {
      concurrent: true,
      description: 'Find entries by name beneath a directory in your workspace.',
      execute: async (args, context) => {
        const target = await resolveTarget(context, args.path);
        if (!target.success) {
          return target;
        }
        const text = await findEntries(target.value, { maxDepth: args.maxDepth, namePattern: args.namePattern });
        return Result.ok(toOutput('workspace find', text));
      },
      parameters: z.object({
        maxDepth: z
          .number()
          .int()
          .min(1)
          .max(WALK_MAX_DEPTH)
          .default(WALK_DEFAULT_DEPTH)
          .describe('How many directory levels to descend'),
        namePattern: z.string().min(1).describe('A glob matched against each entry name, e.g. "*.log"'),
        path: $RelativePath.default('.')
      }),
      retryable: true,
      timeoutMs: 10_000,
      traceDetail: (args) => `${args.namePattern} in ${args.path}`
    },
    grep: {
      concurrent: true,
      description: 'Search the lines of a file, or of every file beneath a directory, in your workspace.',
      execute: async (args, context) => {
        let pattern: RegExp;
        try {
          pattern = new RegExp(args.pattern, 'u');
        } catch {
          return Result.err({ kind: 'invalid-arguments', message: `"${args.pattern}" is not a usable pattern` });
        }
        const target = await resolveTarget(context, args.path);
        if (!target.success) {
          return target;
        }
        const text = await grepFiles(target.value, { maxMatches: args.maxMatches, pattern });
        return Result.ok(toOutput('workspace grep', text));
      },
      parameters: z.object({
        maxMatches: z
          .number()
          .int()
          .min(1)
          .max(GREP_MAX_MATCHES)
          .default(GREP_DEFAULT_MATCHES)
          .describe('Stop after this many matching lines per file'),
        path: $RelativePath.default('.'),
        pattern: z.string().min(1).describe('A regular expression matched against each line')
      }),
      retryable: true,
      timeoutMs: 10_000,
      traceDetail: (args) => `"${args.pattern}" in ${args.path}`
    },
    list: {
      concurrent: true,
      description: 'List the entries of a directory in your workspace.',
      execute: async (args, context) => {
        const target = await resolveTarget(context, args.path);
        if (!target.success) {
          return target;
        }
        const text = await listDirectory(target.value, { all: args.all });
        return Result.ok(toOutput('workspace listing', text));
      },
      parameters: z.object({
        all: z.boolean().default(false).describe('Include entries whose name begins with a dot'),
        path: $RelativePath.default('.')
      }),
      retryable: true,
      timeoutMs: 10_000,
      traceDetail: (args) => args.path
    },
    read: {
      concurrent: true,
      description: 'Read a text file in your workspace, whole or by line range.',
      execute: async (args, context) => {
        const target = await resolveTarget(context, args.path);
        if (!target.success) {
          return target;
        }
        const { text } = await readLines(target.value, { endLine: args.endLine, startLine: args.startLine });
        return Result.ok({ replaySubject: describeReplaySubject(`read ${args.path}`, text), text });
      },
      parameters: z.object({
        endLine: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Last line to return, inclusive; omit to read to the end'),
        path: $RelativePath,
        startLine: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('First line to return, 1-based; omit to read from the start')
      }),
      retryable: true,
      /** §3.8 — a file the model reads once and moves past; a re-read is cheap */
      supersedable: true,
      timeoutMs: 10_000,
      traceDetail: (args) => {
        const whole = args.endLine === undefined && args.startLine === undefined;
        return whole ? args.path : `${args.path} lines ${args.startLine ?? 1}-${args.endLine ?? 'end'}`;
      }
    },
    stat: {
      concurrent: true,
      description: 'Get the kind, size and modification time of an entry in your workspace.',
      execute: async (args, context) => {
        const target = await resolveTarget(context, args.path);
        if (!target.success) {
          return target;
        }
        return Result.ok({ text: await statEntry(target.value) });
      },
      parameters: z.object({ path: $RelativePath }),
      retryable: true,
      timeoutMs: 10_000,
      traceDetail: (args) => args.path
    },
    write: {
      approval: (args) => ({
        body: `Write ${Buffer.byteLength(args.content, 'utf8')} bytes to ${renderCodeSpan(args.path)} in this agent's workspace directory${args.content.endsWith('\n') ? ', ending in a newline' : ''}:\n\n${fenceCodeBlock(stripOneTerminator(args.content))}`,
        presentation: 'collapse'
      }),
      description:
        "Write a text file inside your workspace directory. Parent directories are created as needed. The result is the framework's confirmation that the bytes you sent are the bytes on disk; reading the file back adds nothing.",
      execute: async (args, context) => {
        const target = await resolveTarget(context, args.path);
        if (!target.success) {
          return target;
        }
        await writeFileWhole(target.value.absolute, args.content);
        const lines = args.content === '' ? 0 : stripOneTerminator(args.content).split('\n').length;
        return Result.ok({
          text: `wrote ${args.path}: ${Buffer.byteLength(args.content, 'utf8')} bytes, ${lines} line${lines === 1 ? '' : 's'}, exactly as given`
        });
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
