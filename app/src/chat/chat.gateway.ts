import type { Result } from '@collegium/core/utils';
import type { CommandSurfaceDeclaration, PostErasureReport } from '@collegium/mattermost';

import type { ChatTransport } from './chat.transport.ts';
import type {
  AgentConnection,
  ChatFailure,
  DialogRequest,
  PostFile,
  PostUpdate,
  SystemPostReceipt
} from './chat.types.ts';

/**
 * The command-surface operations throw rather than return Result: they run only during §8.4 boot
 * reconciliation, where every failure is a boot refusal and no caller ever branches.
 */
export abstract class ChatGateway {
  abstract connect(connection: AgentConnection): Promise<ChatTransport>;
  /** tells the team's `/collegium` where to forward and what to autocomplete; refuses without the plugin */
  abstract declareCommandSurface(declaration: CommandSurfaceDeclaration): Promise<void>;
  /** removes every slash command this account created — relics of a release before the plugin; returns how many */
  abstract deleteOwnedSlashCommands(): Promise<number>;
  /** §8.5 — every post in the channel older than the boundary post, deleted by the plugin in one call */
  abstract erasePostsBefore(channelId: string, postId: string): Promise<Result<PostErasureReport, ChatFailure>>;
  /** §6.2 — the substrate's own post-size limit, read from the server so nothing hardcodes it */
  abstract maxPostSizeChars(): Promise<Result<number, ChatFailure>>;
  /** a dialog opened as the system bot, for a command that must be confirmed before it acts (§8.5) */
  abstract openDialogAsSystem(request: DialogRequest): Promise<Result<void, ChatFailure>>;
  /** the main-channel notice path — fixed strings only, never an agent thinking (§3.2) */
  abstract postAsSystem(content: string): Promise<Result<SystemPostReceipt, ChatFailure>>;
  /**
   * The system bot speaking in a named channel: trigger delivery (§4.2) and refusals (§4.5).
   * Files ride the post as real uploads — content larger than a post travels whole this way.
   */
  abstract postAsSystemIn(
    channelId: string,
    content: string,
    files?: readonly PostFile[]
  ): Promise<Result<SystemPostReceipt, ChatFailure>>;
  /**
   * A channel handle — what config names a channel by — to the substrate's id for it. Rejects a
   * handle the team does not hold, so a channel named in config that does not exist is a boot
   * refusal rather than a channel that silently never triggers.
   */
  abstract resolveChannelId(handle: string): Promise<string>;
  /** edits a post the system bot made — a notice that reports its outcome in place (§8.5) */
  abstract updateSystemPost(postId: string, update: PostUpdate): Promise<Result<void, ChatFailure>>;
}
