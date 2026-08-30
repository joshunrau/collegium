import type { Promisable } from 'type-fest';
import type { z } from 'zod';

import type { ToolApprovalPayload, ToolDisclosure } from '../tools.ts';

/** what a plugin tool body may return: the text alone, or the text beside a durable record's disclosure (§3.4) */
export type PluginToolOutput = string | { readonly disclosure?: ToolDisclosure; readonly text: string };

/**
 * The two failures a tool body may raise itself — the rest of the taxonomy (§7.1) is the
 * framework's to raise. Each throws; the perimeter wrapper maps the throw into the taxonomy.
 */
export type PluginToolErr = {
  /** the arguments were rejected — returned to the model as the tool result; the turn continues */
  invalidArguments(message: string): never;
  /** a committed side effect whose outcome cannot be established; the turn ends stating the ambiguity */
  unresolved(message: string): never;
};

/** one tool as a plugin declares it: the framework's tool minus `budgetExempt`, returning plain output */
export type PluginToolDeclaration<TContext, TParams extends z.ZodType> = {
  /** present ⇒ the tool always gates (§5); renders the payload the approver reads and cannot decline */
  approval?(args: z.infer<TParams>): ToolApprovalPayload;
  readonly description: string;
  execute(args: z.infer<TParams>, context: TContext): Promisable<PluginToolOutput>;
  readonly parameters: TParams;
  /** §7.2 — whether a timed-out call may be reported to the model as a plain failure; false ends the turn as unconfirmable */
  readonly retryable?: boolean;
  readonly timeoutMs?: number;
  /** §8.1 — the one-line summary beside the name in the status post; absent shows the name alone */
  traceDetail?(args: z.infer<TParams>): string;
};
