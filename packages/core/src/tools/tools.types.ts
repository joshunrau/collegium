import type { Promisable } from 'type-fest';
import type { z } from 'zod';

import type { ApprovalPayloadPresentation } from '../approvals.ts';
import type { Result } from '../utils.ts';

/**
 * A tool's identity: two segments, held structurally everywhere and rendered per audience (§1).
 * Segments are never parsed back out of a rendered form except at the config perimeter — a name
 * arriving from the model is resolved by lookup against rendered wire names, not by splitting.
 */
export type ToolId = readonly [namespace: string, name: string];

/** the four facts of the running turn (§4) — everything else a tool needs, its toolset declares */
export type ToolTurnScope = {
  readonly agentUsername: string;
  readonly channelId: string;
  /** provenance for anything a tool records; null on a turn no post triggered */
  readonly triggeringPostId: null | string;
  readonly turnId: string;
};

/** §6.2 — the full payload the approver reads; presence of the `approval` hook is what gates a tool (§5) */
export type ToolApprovalPayload = {
  body: string;
  presentation: ApprovalPayloadPresentation;
};

/** §3.7a — the question a human reads, and the short answers offered as buttons beside free text */
export type ToolAskPayload = {
  readonly options?: readonly string[];
  readonly question: string;
};

/**
 * A durable record's disclosure (§3.6), returned by the tool that created it; the turn writes the
 * event the trace reads back. `reference` names the record for later reads, e.g. a memory id.
 */
export type ToolDisclosure = {
  readonly body: string;
  readonly description: string;
  readonly reference: string;
  /** a record revised in place, which keeps its reference: its revision count after this change, and what the change replaced (§3.6) */
  readonly revision?: {
    readonly count: number;
    /** the description before this change, where the change named a new one */
    readonly replacedDescription?: string;
    /** the passages the change substituted, or the whole body it rewrote */
    readonly replacedPassages?: readonly string[];
  };
  /** the reference of the record this one replaced in the same step, which no longer resolves */
  readonly revisionOf?: string;
  readonly supersededDescriptions?: readonly string[];
};

/**
 * §3.15 — a post the framework publishes under the agent's account beside the call's result: the
 * record this call made visible. The tool decides the text; the framework decides whether it may
 * post (§4.5), publishes it, and only then calls `onPublished`.
 */
export type ToolPost = {
  /** the one peer this post addresses; any other agent the text names loses its @ before posting (§4.5) */
  readonly addressee?: string;
  /**
   * Called once the post has landed and been recorded, with its id — the one moment the tool writes
   * anything durable. Never called when the post is refused (§4.5) or fails to deliver (§7.1), so
   * nothing is written for a change the channel never saw.
   */
  readonly onPublished: (postId: string) => Promise<void>;
  readonly text: string;
};

/**
 * §3.8 — `replay` or `replaySubject` stands in for `text` once the model has moved past it: a
 * document the agent will load again anyway, or a page it has already acted on, need not be paid
 * for on every turn whose window still holds the result. Either the line itself, which a tool owns
 * and later turns see verbatim, or the subject alone (`page https://…, 18432 characters`), from
 * which the framework renders the later-turn line and the in-turn collapse line each in its own
 * words. Never both. A result that names neither replays to later turns as its tool's name and
 * size once it is longer than `REPLAY_VERBATIM_MAX_CHARS`.
 */
export type ToolOutput = {
  /**
   * §3.8 — the part of `text` that says what the result holds, where the rest names where it was
   * read: a page's body without its address. A later result whose content matches is the same
   * content read again, whatever the rest says. Absent, the whole text is the content.
   */
  readonly contentIdentity?: string;
  readonly disclosure?: ToolDisclosure;
  /** §3.15 — framework tools only; a plugin's output type carries no post */
  readonly post?: ToolPost;
  readonly text: string;
  /** §8.1 — what the call came to, shown after its line in the status post: the page a click landed on, the status a fetch got */
  readonly traceOutcome?: string;
} & (
  | { readonly replay?: never; readonly replaySubject?: string }
  | { readonly replay?: string; readonly replaySubject?: never }
);

export declare namespace ToolFailure {
  /** the tool body threw — a semantic failure that terminates the turn (§7.1, §7.2) */
  type Exception = {
    kind: 'exception';
    message: string;
  };
  /** the arguments were rejected — returned to the model as the tool result; the turn continues */
  type InvalidArguments = {
    kind: 'invalid-arguments';
    message: string;
  };
  /** execution outlived `timeoutMs` — for a mutation the side effect is unconfirmed (§7.1, §7.2) */
  type Timeout = {
    kind: 'timeout';
    timeoutMs: number;
  };
  /**
   * The tool committed something whose outcome cannot be established — a send that may or may not
   * have left. The turn ends stating the ambiguity (§7.1); it is never returned to the model,
   * because a model told "unresolved" will try again, which is precisely what must not happen.
   */
  type Unresolved = {
    kind: 'unresolved';
    message: string;
  };
  /** the model named a tool that does not exist or sits outside its configured set (§6.1, §7.2) */
  type UnknownTool = {
    kind: 'unknown-tool';
    message: string;
  };
  type Any = Exception | InvalidArguments | Timeout | UnknownTool | Unresolved;
}

export type ToolFailure = ToolFailure.Any;

/** the settings a toolset context carries, or `unknown` for a context declaring none */
export type ToolContextSettings<TContext> = TContext extends { readonly settings: infer TSettings }
  ? TSettings
  : unknown;

/** the methods of a storage collection that leave the store as they found it: all of storage an approval render reaches (§3.4) */
export type ToolStorageReadMethod = 'findById' | 'findFirst' | 'findMany';

/**
 * What an approval render receives, derived from what `execute` receives (§3.4): the settings where
 * the context carries them, and of each storage handle only its read half — no service, no write,
 * and no turn.
 */
export type ToolApprovalContext<TContext> = Pick<TContext, Extract<keyof TContext, 'settings'>> &
  (TContext extends { readonly storage: infer TStorage }
    ? {
        readonly storage: {
          readonly [K in keyof TStorage]: Pick<TStorage[K], Extract<keyof TStorage[K], ToolStorageReadMethod>>;
        };
      }
    : unknown);

/** what an execution settles to; `execute` may return it sync or promised */
export type ToolResult = Result<ToolOutput, ToolFailure>;

/**
 * One tool: one action (§3). Methods rather than properties, deliberately — method bivariance is
 * what lets every concrete tool flow into `AnyTool` for the registry and executor.
 */
export type ToolDefinition<TContext, TParams extends z.ZodType> = {
  /**
   * Present ⇒ the tool always gates (§5); renders the payload the approver reads and cannot decline,
   * from the arguments and whatever of the settings and stored records the context holds (§3.4).
   * Optional here and required on a plugin tool (`$PluginTool`), because a framework toolset's
   * source is read by whoever maintains it while a plugin's may live in another repository: for us
   * an omission is visible, for them it is indistinguishable from a mistake (§3.14).
   */
  approval?(args: z.infer<TParams>, context: ToolApprovalContext<TContext>): Promisable<ToolApprovalPayload>;
  /**
   * Present ⇒ the tool always asks (§3.7a): a question whose answer becomes the call's result,
   * never a consent decision, so there is no body to run and no denial. A tool declares this or
   * `approval`; the registry refuses one declaring both.
   */
  ask?(args: z.infer<TParams>): ToolAskPayload;
  /** §5.3 — never billed against the action budget; framework toolsets only, rejected at the plugin perimeter (§6) */
  readonly budgetExempt?: boolean;
  /**
   * The call may run alongside the other concurrent calls of the same completion rather than after
   * them. For a read that neither depends on nor disturbs what another call in the batch touches;
   * a browser action is not one, since every action on the turn's one page follows the last.
   */
  readonly concurrent?: boolean;
  readonly description: string;
  execute(args: z.infer<TParams>, context: TContext): Promisable<ToolResult>;
  /**
   * Whether the acting agent's effective settings let this tool work at all. False leaves it out
   * of a namespace grant and refuses an explicit one at boot. Framework toolsets only; rejected at
   * the plugin perimeter (§6).
   */
  isAvailableWith?(settings: ToolContextSettings<TContext>): boolean;
  readonly parameters: TParams;
  /** §7.2 — whether a timed-out call may be reported to the model as a plain failure; false ends the turn as unconfirmable */
  readonly retryable?: boolean;
  /**
   * A later result of any supersedable tool in the same turn makes this one stale: once more than
   * the retained few exist, the model reads its `replay` line in place of the text (§3.8). For a
   * page or document the model acts on once and moves past, never for anything it keeps re-reading.
   */
  readonly supersedable?: boolean;
  readonly timeoutMs?: number;
  /** §8.1 — the one-line summary beside the name in the status post; absent shows the name alone */
  traceDetail?(args: z.infer<TParams>): string;
  /**
   * §8.1 — what the call would come to, beside the summary: the bytes a write would put on disk, the
   * rows a delete would remove. Separate from `traceDetail` because a call the gate never ran keeps
   * its subject and loses this.
   */
  traceEffect?(args: z.infer<TParams>): string;
};
