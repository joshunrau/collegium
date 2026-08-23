import type { ToolResult } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';

export function ok(text: string): ToolResult {
  return Result.ok({ text });
}

/** the failures a tool body may raise itself; timeout and unknown-tool are the framework's to raise */
export const fail = {
  /** a semantic failure that terminates the turn (§7.1) */
  exception: (message: string): ToolResult => Result.err({ kind: 'exception', message }),
  /** returned to the model as the tool result; the turn continues */
  invalidArguments: (message: string): ToolResult => Result.err({ kind: 'invalid-arguments', message }),
  /** a committed side effect whose outcome cannot be established; the turn ends stating the ambiguity (§7.1) */
  unresolved: (message: string): ToolResult => Result.err({ kind: 'unresolved', message })
};
