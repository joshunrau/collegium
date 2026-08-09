export type CommandInput = {
  channelId: string;
  text: string;
  username: string;
};

export type CommandResponse = {
  /**
   * Work the announcement must precede. A drain started before its own notice posts lands its
   * replies above it, and — while a command response carries the invoking human's name — the
   * notice folds into the very turn it announced (§4.4).
   */
  afterAnnouncing?: () => Promise<void>;
  /** §3.2 — what the channel sees is the system bot's, never the invoker's; `invoker` stays ephemeral */
  audience: 'channel' | 'invoker';
  text: string;
};
