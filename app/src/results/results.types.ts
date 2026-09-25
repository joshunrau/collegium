/** §3.8 — one result of a turn as its event recorded it: the whole text, and the width of the view it was shown in */
export type RecordedResult = {
  readonly output: string;
  readonly recordedAt: Date;
  /** absent on a result the runner answered itself, which carries no reference and was shown whole */
  readonly viewChars: number | undefined;
};
