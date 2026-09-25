import type { ToolId } from '@collegium/core/tools';

import type { ReasoningDetail } from '@/core/core.types.ts';
import type { CompletionUsage, EstimatedCompletionUsage } from '@/inference/inference.types.ts';

import type { Prisma, PrismaClient } from './generated/client.ts';
import type { ApprovalStatus, TurnEventKind } from './generated/enums.ts';

type ApprovalDecisionStatus = Exclude<ApprovalStatus, 'invalidated' | 'pending'>;

type RecordedToolCall = {
  args: unknown;
  callId: string;
  toolName: PrismaJson.RecordedToolName;
};

/**
 * §8.2 — what one completion's own event records of it: what the provider reported, which upstream
 * served it, and whether a relief pass had edited the prompt since the previous completion, so the
 * cached share of the one after a relief can be read against the rest (§3.8). The turn's row stays
 * the authoritative total; these are never summed into it.
 */
type CompletionRecord = {
  afterRelief?: true;
  servedBy?: string;
  usage?: CompletionUsage;
};

type TurnEventPayloadByKind = {
  approval_decided: {
    approvalId: string;
    byUsername: string;
    /** the tool call the approval gated; absent for a framework action such as the budget extension */
    callId?: string;
    decision: ApprovalDecisionStatus;
    reason?: string;
  };
  approval_requested: {
    approvalId: string;
    callId?: string;
    /** §3.7 — the context line as the approver read it; absent where none was shown */
    contextText?: string;
    payloadText: string;
    toolName: PrismaJson.RecordedToolName;
  };
  ask_answered: {
    answerText: string;
    askId: string;
    byUsername: string;
    callId: string;
  };
  ask_requested: {
    askId: string;
    callId: string;
    options?: PrismaJson.AskOptions;
    question: string;
    toolName: PrismaJson.RecordedToolName;
  };
  assistant_message: CompletionRecord & {
    content: string;
    reasoningContent?: string;
    reasoningDetails?: readonly ReasoningDetail[];
    toolCalls: RecordedToolCall[];
  };
  /** §4.5 — a final output refused as a post: never replayed, since the model was told why and answered again (§8.3) */
  output_rejected: Omit<CompletionRecord, 'usage'> & {
    content: string;
    /** the rejection exactly as the model read it */
    reason: string;
    /** §8.2 — what the provider reported; a completion cut at its time limit reports none, so this estimates what it had streamed (§7.1) */
    usage?: CompletionUsage | EstimatedCompletionUsage;
  };
  record_written: {
    body: string;
    description: string;
    reference: string;
    revision?: { count: number; replacedDescription?: string; replacedPassages?: readonly string[] };
    revisionOf?: string;
    supersededDescriptions: string[];
  };
  /** §7.5 — a human corrected this turn mid-flight; replayed to a later turn as the human speaking */
  steering_received: {
    byUsername: string;
    text: string;
    /** §7.5 — where the steer aborted a completion in flight, which reports no usage, an estimate of what it had streamed */
    usage?: EstimatedCompletionUsage;
  };
  tool_result: {
    callId: string;
    output: string;
    /** §3.8 — how the model read the output where it did not read it whole; the output stays whole here */
    presentedAs?: ResultPresentation;
    /** §7.2 — the head of argument text that never parsed, for the trace alone */
    rawArgumentsPreview?: string;
    /** the line the window replays in place of the output, as a plugin tool or a row from before `replaySubject` wrote it; the trace still shows the output */
    replay?: string;
    /** what the output was, from which the window renders its replay line (§3.8) */
    replaySubject?: string;
    toolName: PrismaJson.RecordedToolName;
    /** §8.1 — the disposition the call's status-post line carries, where it was not plain success */
    traceMark?: TraceMark;
  };
};

declare global {
  namespace PrismaJson {
    type ApprovalArgs = unknown;

    /** §3.7a — the short answers a question offered as buttons; null where it offered none */
    type AskOptions = string[];

    /** the files one post carried, as the window names them (§3.8); null on every row written before they were parsed */
    type PostAttachments = {
      readonly files: readonly {
        readonly id: string;
        readonly mimeType: string;
        readonly name: string;
        readonly size: number;
      }[];
    };

    /**
     * The segments of a library tool, structurally (§10); a bare string is a name that resolved to
     * no tool — unresolvable model output, or a framework action like the budget extension.
     */
    type RecordedToolName = string | ToolId;

    /** the wrapper keeps the stored value off the column's top level, where a bare JSON null would collide with Prisma's null sentinels */
    type ToolsetRecordPayload = {
      value: unknown;
    };

    type TriggerReference = {
      [key: string]: unknown;
      body?: string;
      id?: string;
      sender?: string;
      subject?: string;
    };

    type TurnEventPayload = {
      [TKind in TurnEventKind]: TurnEventPayloadByKind[TKind] & { kind: TKind };
    }[TurnEventKind];
  }
}

/**
 * §8.1 — a call's disposition for its status-post line, and whether the call ran at all: a line
 * whose mark says it did not states its subject and not its effect. The result's event keeps it, so
 * the status post and the trace read one record (§8.3).
 */
export type TraceMark = {
  readonly ran: boolean;
  readonly text: string;
};

/**
 * §3.8 — how the model came to read a result: the width of the view it arrived in, how much of it a
 * view showed where that was not all of it, a repeat answered with a line naming the result it
 * repeats, and its collapse to a line once read. `cutToChars` is what events from before views
 * recorded: a cut with no read-on, read back as one.
 */
export type ResultPresentation = {
  collapsed?: true;
  cutToChars?: number;
  /** the reference of the earlier result, still shown, whose text this one repeats */
  repeatOf?: string;
  shownChars?: number;
  viewChars?: number;
};

export type PrismaModelName = Prisma.ModelName;

export type PrismaModelKey<T extends PrismaModelName = PrismaModelName> = Uncapitalize<T>;

export type Model<T extends PrismaModelName> = PrismaClient[PrismaModelKey<T>];

/** the client inside an interactive `$transaction`, handed to each module that cuts its own tables in it (§8.5) */
export type TransactionClient = Prisma.TransactionClient;

/** a row as it is read back, derived from the delegate so the generated client stays inside this module */
export type ModelRow<T extends PrismaModelName> = Awaited<ReturnType<Model<T>['findFirstOrThrow']>>;

export type {
  ActivationKind,
  ApprovalStatus,
  AskStatus,
  AuthorKind,
  PostKind,
  TriggerSource,
  TurnStatus,
  WorkUnitState
} from './generated/enums.ts';
