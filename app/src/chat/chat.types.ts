import type { Promisable } from 'type-fest';

import type { AgentIdentity } from '@/agents/agents.types.ts';
import type { ObservedPost } from '@/conversations/conversations.types.ts';
import type { AuthorKind } from '@/prisma/prisma.types.ts';

export type AgentConnection = {
  agent: AgentIdentity;
  botToken: string;
};

export type AuthorClassifier = (username: string) => AuthorKind;

/** what a channel is to its readers: open is readable by the whole team, the rest by members alone (§3.8) */
export type ChannelKind = 'direct' | 'group' | 'open' | 'private';

export type ChannelDescription = {
  /** empty where the substrate gives none, as on a direct channel */
  readonly displayName: string;
  readonly kind: ChannelKind;
  readonly memberUsernames: readonly string[];
};

export declare namespace ChatEvent {
  /**
   * Someone entered or left a channel this agent is in — the roster's only write path (§3.11).
   * `agentUsername` is who observed it; `username` is who moved, and may be the agent itself.
   */
  type Membership = {
    agentUsername: string;
    channelId: string;
    kind: 'user_added_to_channel' | 'user_removed_from_channel';
    username: string;
  };
  type Posted = {
    kind: 'posted';
    post: ObservedPost;
  };
  /**
   * The socket reconnected without resuming its session, so an unknown number of events were never
   * delivered. It says only *that* something was missed, never what — repairing means re-reading
   * the channels (§8.2's primitive, a different occasion).
   */
  type Resync = {
    agentUsername: string;
    kind: 'resync';
  };
  type Any = Membership | Posted | Resync;
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
  /** markdown shown above the elements — the whole of a confirmation dialog that has none (§8.5) */
  readonly introductionText?: string;
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
  /** uploads riding the post — how an over-limit approval payload reaches its approver (§6.2) */
  files?: readonly PostFile[];
  text: string;
};

/** content too large for a post, travelling whole as a real upload beside it (§6.2, §4.2, §8.3) */
export type PostFile = {
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
