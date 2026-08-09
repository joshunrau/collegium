import type { Result } from '@collegium/core/utils';

import type { ObservedPost } from '@/conversations/conversations.types.ts';

import type { ChatEventHandler, ChatFailure, DialogRequest, OutgoingChatMessage, PostUpdate } from './chat.types.ts';

export abstract class ChatTransport {
  abstract addReaction(postId: string, emoji: string): Promise<Result<void, ChatFailure>>;
  /** §3.7 — who a decision's user id actually is, since the displayed byline may not be trusted */
  abstract describeUser(userId: string): Promise<Result<{ isBot: boolean; username: string }, ChatFailure>>;
  abstract disconnect(): void;
  /** the reconcile read (§3.11): every channel this agent is a member of, by its own token */
  abstract getChannelMemberships(): Promise<Result<string[], ChatFailure>>;
  /** the §3.7 authority check: presence in the channel is what confers the right to decide */
  abstract isChannelMember(channelId: string, userId: string): Promise<Result<boolean, ChatFailure>>;
  /** §4.2 — a DM can never receive the system bot, so trigger intake must refuse one loudly */
  abstract isDirectMessageChannel(channelId: string): Promise<Result<boolean, ChatFailure>>;
  abstract listen(onEvent: ChatEventHandler): void;
  /** §6.2 — the substrate's own post-size limit (`MaxPostSize`), read here so nothing hardcodes it */
  abstract maxPostSizeChars(): Promise<Result<number, ChatFailure>>;
  abstract openDialog(request: DialogRequest): Promise<Result<void, ChatFailure>>;
  /** the backfill read (§8.2): everything after the named post, oldest first; recent history when unnamed */
  abstract postsSince(channelId: string, postId: string | undefined): Promise<Result<ObservedPost[], ChatFailure>>;
  abstract send(message: OutgoingChatMessage): Promise<Result<{ createdAt: Date; postId: string }, ChatFailure>>;
  /** §8.1 — the ephemeral "composing" signal: no post, no store write, dropped if the socket is down */
  abstract signalTyping(channelId: string): void;
  abstract updatePost(postId: string, update: PostUpdate): Promise<Result<void, ChatFailure>>;
}
