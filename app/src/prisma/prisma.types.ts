import type { Prisma, PrismaClient } from './generated/client.ts';
import type { ApprovalStatus, TurnEventKind } from './generated/enums.ts';

type ApprovalDecisionStatus = Exclude<ApprovalStatus, 'invalidated' | 'pending'>;

type RecordedToolCall = {
  args: unknown;
  callId: string;
  toolName: string;
};

type TurnEventPayloadByKind = {
  approval_decided: {
    approvalId: string;
    byUsername: string;
    decision: ApprovalDecisionStatus;
    reason?: string;
  };
  approval_requested: {
    approvalId: string;
    payloadText: string;
    toolName: string;
  };
  assistant_message: {
    content: string;
    toolCalls: RecordedToolCall[];
  };
  memory_written: {
    body: string;
    description: string;
    memoryId: string;
  };
  tool_result: {
    callId: string;
    output: string;
    toolName: string;
  };
};

declare global {
  namespace PrismaJson {
    type ApprovalArgs = unknown;

    /** the wrapper keeps the stored value off the column's top level, where a bare JSON null would collide with Prisma's null sentinels */
    type PluginRecordPayload = {
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

export type PrismaModelName = Prisma.ModelName;

export type PrismaModelKey<T extends PrismaModelName = PrismaModelName> = Uncapitalize<T>;

export type Model<T extends PrismaModelName> = PrismaClient[PrismaModelKey<T>];

/** a row as it is read back, derived from the delegate so the generated client stays inside this module */
export type ModelRow<T extends PrismaModelName> = Awaited<ReturnType<Model<T>['findFirstOrThrow']>>;

export type { ApprovalStatus, AuthorKind, TriggerSource, TurnStatus } from './generated/enums.ts';
