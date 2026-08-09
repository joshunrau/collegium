/** what the process runner captures from a finished child, before any domain interpretation */
export type CapturedProcess = {
  readonly code: null | number;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
};

/** the child could not be launched at all (e.g. `sudo` missing) — distinct from a non-zero exit */
export type ShellSpawnFailure = {
  readonly message: string;
};

/** what a completed shell run yields the tool: one text block describing exit status and output */
export type ShellRunOutput = {
  readonly text: string;
};

/** a run that never produced an exit status, because the command could not be launched */
export type ShellRunFailure = {
  readonly message: string;
};
