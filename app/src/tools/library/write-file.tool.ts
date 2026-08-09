import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { WRITE_FILE_TOOL_NAME } from '../tools.constants.ts';

type $WriteFileArgs = z.infer<typeof $WriteFileArgs>;
const $WriteFileArgs = z.object({
  content: z.string().describe('The full content the file will hold'),
  path: z
    .string()
    .min(1)
    .describe('Where to write, relative to your workspace; absolute paths and traversal are rejected')
});

@Injectable()
export class WriteFileTool extends Tool({
  description: 'Write a text file inside your workspace directory. Parent directories are created as needed.',
  name: WRITE_FILE_TOOL_NAME,
  parameters: $WriteFileArgs,
  timeoutMs: 10_000,
  variant: 'gated'
}) {
  async execute(args: $WriteFileArgs, turn: Tool.TurnScope): Promise<Tool.Result> {
    await fs.promises.mkdir(turn.workspaceDir, { mode: 0o700, recursive: true });
    const resolved = this.resolveWorkspacePath(turn.workspaceDir, args.path);
    if (!resolved.success) {
      return resolved;
    }
    await fs.promises.mkdir(path.dirname(resolved.value), { recursive: true });
    // temp file beside the target, then rename — a crash mid-write cannot leave a half file
    const staging = path.join(path.dirname(resolved.value), `.${path.basename(resolved.value)}.${randomUUID()}.tmp`);
    await fs.promises.writeFile(staging, args.content, 'utf8');
    await fs.promises.rename(staging, resolved.value);
    return Result.ok({ text: `wrote ${args.path} (${Buffer.byteLength(args.content, 'utf8')} bytes)` });
  }

  /**
   * The full payload, not the intent — a payload nobody can read is a payload nobody is checking.
   * A long file body goes behind an expandable control; only shell demands verbatim (§6.2).
   */
  getApprovalRequirements({ content, path: requested }: $WriteFileArgs): Tool.ApprovalRequirements.Gated {
    return {
      kind: 'gated',
      payload: {
        body: `Write to \`${requested}\`:\n\n\`\`\`\n${content}\n\`\`\``,
        presentation: 'collapse'
      }
    };
  }

  /** a mutation — never retried, because a timeout leaves us unable to say whether it landed (§7.2) */
  isRetryable(): false {
    return false;
  }

  /** the path and the size; the content itself is in the approval payload and in `/trace` */
  renderTraceDetail({ content, path: requested }: $WriteFileArgs): string {
    return `${requested} (${Buffer.byteLength(content, 'utf8')} bytes)`;
  }

  private deepestExistingAncestor(candidate: string): string {
    let probe = candidate;
    while (!fs.existsSync(probe)) {
      probe = path.dirname(probe);
    }
    return probe;
  }

  private isWithin(root: string, candidate: string): boolean {
    return candidate === root || candidate.startsWith(root + path.sep);
  }

  /**
   * The entire confinement boundary for the only tool that mutates anything outside SQLite (§6.1).
   * Every rejection is the model's ordinary mistake, returned as `invalid-arguments` so the turn
   * continues. The root is realpathed before the prefix check so a symlinked workspace does not
   * defeat it, the deepest existing ancestor is realpathed so a symlinked directory inside the
   * workspace cannot lead out of it, and a symlinked target is refused outright.
   *
   * This method is not a validation helper — it is the only thing standing between a tool-only
   * agent and the filesystem, and §6.1 is explicit that this weaker confinement "depends on our
   * code being correct". (The `shell` tool is confined differently: by a dedicated OS user, not by
   * this resolver — the two boundaries are deliberately separate, §A2.) It carries a
   * disproportionate number of tests relative to its size on purpose. Resist every request to
   * widen it; a second gated write tool with its own path handling would be two boundaries that
   * must agree.
   */
  private resolveWorkspacePath(workspaceDir: string, requested: string): Result<string, Tool.Failure.InvalidArguments> {
    if (path.isAbsolute(requested)) {
      return Result.err({ kind: 'invalid-arguments', message: `"${requested}" is absolute; paths must be relative` });
    }
    const realRoot = fs.realpathSync(workspaceDir);
    const candidate = path.resolve(realRoot, requested);
    if (!this.isWithin(realRoot, candidate)) {
      return Result.err({ kind: 'invalid-arguments', message: `"${requested}" escapes the workspace` });
    }
    const realAncestor = fs.realpathSync(this.deepestExistingAncestor(candidate));
    if (!this.isWithin(realRoot, realAncestor)) {
      return Result.err({ kind: 'invalid-arguments', message: `"${requested}" resolves outside the workspace` });
    }
    if (fs.lstatSync(candidate, { throwIfNoEntry: false })?.isSymbolicLink()) {
      return Result.err({ kind: 'invalid-arguments', message: `"${requested}" is a symbolic link` });
    }
    return Result.ok(candidate);
  }
}
