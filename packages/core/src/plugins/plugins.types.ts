import type { Promisable } from 'type-fest';
import type { z } from 'zod';

import type { ToolApprovalContext, ToolApprovalPayload, ToolDisclosure } from '../tools.ts';

/** what a plugin tool body may return: the text alone, or the text beside a durable record's disclosure and the line later turns replay (§3.4) */
export type PluginToolOutput =
  string | { readonly disclosure?: ToolDisclosure; readonly replay?: string; readonly text: string };

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

/** one tool as a plugin declares it: the framework's tool minus `budgetExempt` and `isAvailableWith`, returning plain output */
export type PluginToolDeclaration<TContext, TParams extends z.ZodType> = {
  /**
   * The payload the approver reads, or `null` for a tool that does not gate. Required, unlike the
   * framework's own optional field: a framework toolset is read as source by whoever maintains it,
   * while a plugin's source may not be in this repository at all, so an omitted field cannot be
   * told from a forgotten one (§3.14). A function ⇒ the tool always gates (§3.7) and cannot decline;
   * it may read the settings and the stored records the call acts on (§3.4).
   */
  approval:
    ((args: z.infer<TParams>, context: ToolApprovalContext<TContext>) => Promisable<ToolApprovalPayload>) | null;
  /** may run alongside the other concurrent calls of one completion: a read that touches nothing another call in the batch does */
  readonly concurrent?: boolean;
  readonly description: string;
  execute(args: z.infer<TParams>, context: TContext): Promisable<PluginToolOutput>;
  readonly parameters: TParams;
  /** §7.2 — whether a timed-out call may be reported to the model as a plain failure; false ends the turn as unconfirmable */
  readonly retryable?: boolean;
  /** a later result of any supersedable tool in the same turn replaces this one's text with its replay line, past the retained few (§3.8) */
  readonly supersedable?: boolean;
  readonly timeoutMs?: number;
  /** §8.1 — the one-line summary beside the name in the status post; absent shows the name alone */
  traceDetail?(args: z.infer<TParams>): string;
};
