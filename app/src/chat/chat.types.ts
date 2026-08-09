import type { Promisable } from 'type-fest';

import type { AgentIdentity } from '@/agents/agents.types.ts';
import type { ObservedPost } from '@/conversations/conversations.types.ts';
import type { AuthorKind } from '@/prisma/prisma.types.ts';

export type AgentConnection = {
  agent: AgentIdentity;
  botToken: string;
};

export type AuthorClassifier = (username: string) => AuthorKind;

export declare namespace ChatEvent {
  /** an agent of this process entered or left a channel — the roster's only write path (§3.11) */
  type Membership = {
    agentUsername: string;
    channelId: string;
    kind: 'user_added_to_channel' | 'user_removed_from_channel';
  };
  type Posted = {
    kind: 'posted';
    post: ObservedPost;
  };
  type Any = Membership | Posted;
}

export type ChatEvent = ChatEvent.Any;

export type ChatEventHandler = (event: ChatEvent) => Promisable<void>;

export declare namespace ChatFailure {
  /** the Mattermost API refused or the wire failed — the caller decides what a lost post means */
  type Api = {
    kind: 'api';
    message: string;
    status?: number;
  };
  type Any = Api;
}

export type ChatFailure = ChatFailure.Any;

export type DialogElement = {
  readonly displayName: string;
  readonly name: string;
  readonly optional?: boolean;
  readonly type: 'textarea';
};

export type DialogRequest = {
  readonly callbackId: string;
  readonly elements: readonly DialogElement[];
  /** echoed back verbatim on submission — how request-time facts survive the round trip */
  readonly state?: string;
  readonly submitLabel?: string;
  readonly title: string;
  readonly triggerId: string;
  readonly url: string;
};

/** Mattermost interactive message attachments — how approval buttons exist at all (§3.7) */
export type MessageAttachment = {
  readonly actions?: readonly MessageAttachmentAction[];
  readonly fallback?: string;
  readonly text?: string;
  readonly title?: string;
};

export type MessageAttachmentAction = {
  readonly id: string;
  readonly integration: {
    readonly context?: { readonly [key: string]: string };
    readonly url: string;
  };
  readonly name: string;
  readonly style?: 'danger' | 'default' | 'primary';
};

export type OutgoingChatMessage = {
  attachments?: readonly MessageAttachment[];
  channelId: string;
  text: string;
};

/** what registering one slash command requires — everything else about the wire is the adapter's */
export type SlashCommandRegistration = {
  readonly autoCompleteHint: string;
  readonly description: string;
  readonly displayName: string;
  readonly trigger: string;
  readonly url: string;
};

/** one command as the team currently holds it, with its creator resolved for the §8.4 refusal text */
export type RegisteredSlashCommand = {
  readonly autoComplete: boolean;
  readonly autoCompleteHint: string;
  readonly creatorId: string;
  readonly creatorUsername: string;
  readonly description: string;
  readonly displayName: string;
  readonly id: string;
  readonly method: string;
  readonly trigger: string;
  readonly url: string;
};

/** everything §8.4 reconciliation needs in one read: the team's commands and who this app is */
export type SlashCommandSurface = {
  readonly commands: readonly RegisteredSlashCommand[];
  readonly ownUserId: string;
};

/** a text file riding a system post — how content larger than a post travels whole (§6.2) */
export type SystemPostFile = {
  readonly content: string;
  readonly filename: string;
};

/** what the system bot's post came back as — enough for the caller to point at it later */
export type SystemPostReceipt = {
  readonly authorUsername: string;
  readonly createdAt: Date;
  readonly postId: string;
};

export type PostUpdate = {
  /** replaces the existing attachments outright — an empty array is how buttons are removed (§3.7) */
  readonly attachments?: readonly MessageAttachment[];
  readonly text: string;
};
