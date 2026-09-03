/** what introduced a segment says about it: real headers for the head, the boundary line's words for a quoted one */
export type MailSegmentEnvelope = {
  readonly cc?: string;
  readonly date?: string;
  readonly from?: string;
  readonly subject?: string;
  readonly to?: string;
};

export type MailSegment = {
  readonly body: string;
  readonly envelope: MailSegmentEnvelope;
};

/** one message at the boundaries its sender's client wrote: the sender's own words, then the quoted history newest first */
export type MailThread = {
  readonly headBody: string;
  readonly quoted: readonly MailSegment[];
};
