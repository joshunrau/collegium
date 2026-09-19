/** what the human asked for, as the dialog carries it from the command to its submission (§8.5) */
export type ClearingState = {
  readonly byUsername: string;
  readonly channelId: string;
  /** when the command opened the dialog, so a submission cannot be honoured indefinitely */
  readonly issuedAt: string;
  readonly memories: boolean;
};

export declare namespace ClearingRefusal {
  /** a turn holds the channel, named so the human knows what to stop or kill (§8.5) */
  type Busy = {
    agentUsernames: readonly string[];
    kind: 'busy';
  };
  type DialogUndeliverable = {
    kind: 'dialog-undeliverable';
    message: string;
  };
  type Expired = {
    kind: 'expired';
  };
  type NoTrigger = {
    kind: 'no-trigger';
  };
  type StoreFailed = {
    kind: 'store-failed';
  };
  type Unannounced = {
    kind: 'unannounced';
  };
  type Any = Busy | DialogUndeliverable | Expired | NoTrigger | StoreFailed | Unannounced;
}

export type ClearingRefusal = ClearingRefusal.Any;

/** the memories one agent wrote from turns in the cleared channel, by id (§8.5) */
export type MemoryTally = {
  readonly agentUsername: string;
  readonly memoryIds: readonly string[];
};
