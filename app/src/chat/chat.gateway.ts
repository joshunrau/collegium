import type { Result } from '@collegium/core/utils';

import type { ChatTransport } from './chat.transport.ts';
import type {
  AgentConnection,
  ChatFailure,
  SlashCommandRegistration,
  SlashCommandSurface,
  SystemPostFile,
  SystemPostReceipt
} from './chat.types.ts';

/**
 * The slash-command operations throw rather than return Result: they run only during §8.4 boot
 * reconciliation, where every failure is a boot refusal and no caller ever branches.
 */
export abstract class ChatGateway {
  abstract connect(connection: AgentConnection): Promise<ChatTransport>;
  abstract correctSlashCommand(commandId: string, registration: SlashCommandRegistration): Promise<void>;
  abstract createSlashCommand(registration: SlashCommandRegistration): Promise<void>;
  abstract deleteSlashCommand(commandId: string): Promise<void>;
  /** §6.2 — the substrate's own post-size limit, read from the server so nothing hardcodes it */
  abstract maxPostSizeChars(): Promise<Result<number, ChatFailure>>;
  /** the main-channel notice path — fixed strings only, never an agent thinking (§3.2) */
  abstract postAsSystem(content: string): Promise<Result<SystemPostReceipt, ChatFailure>>;
  /**
   * The system bot speaking in a named channel: trigger delivery (§4.2) and refusals (§4.5).
   * Files ride the post as real uploads — content larger than a post travels whole this way.
   */
  abstract postAsSystemIn(
    channelId: string,
    content: string,
    files?: readonly SystemPostFile[]
  ): Promise<Result<SystemPostReceipt, ChatFailure>>;
  abstract snapshotSlashCommandSurface(): Promise<SlashCommandSurface>;
}
