import type { PostErasureReport } from '@collegium/mattermost';
import { match } from 'ts-pattern';

import type { ClearingRefusal } from './clearing.types.ts';

const DELETED =
  "Every post here will be deleted, and every agent's record of them: context, traces, approvals, queued work";

const RUN_AGAIN = 'Run /collegium clear again.';

type Outcome = {
  readonly byUsername: string;
  /** agents whose `--memories` deletion failed, which the notice must still state (A4) */
  readonly memoryFailures: readonly string[];
};

function withMemoryFailures(text: string, agentUsernames: readonly string[]): string {
  if (agentUsernames.length === 0) {
    return text;
  }
  const failures = agentUsernames.map((agentUsername) => {
    return `${agentUsername}'s memories could not be deleted; see /collegium memory ${agentUsername}.`;
  });
  return `${text} ${failures.join(' ')}`;
}

/** the whole of the confirmation dialog: two sentences, no counts (§8.5) */
export function renderDialogIntroduction(memories: boolean): string {
  if (memories) {
    return `${DELETED}, open units and the memories written here. The agents keep their files and their usage history.`;
  }
  return `${DELETED} and open units. The agents keep their files, their memories and their usage history.`;
}

/** the notice as first posted — the boundary both stores are cut against */
export function renderClearingNotice(byUsername: string): string {
  return `🧹 ${byUsername} is clearing this channel.`;
}

/** the notice once the plugin has answered: every post gone, or how many it could not remove */
export function renderClearedNotice(input: Outcome & { readonly report: PostErasureReport }): string {
  const { deleted, failed } = input.report;
  const lead =
    failed === 0
      ? `🧹 ${input.byUsername} cleared this channel: ${deleted} post(s) removed; the agents start fresh here.`
      : `🧹 ${input.byUsername} cleared this channel for the agents; ${failed} of ${deleted + failed} post(s) could not be removed. ${RUN_AGAIN}`;
  return withMemoryFailures(lead, input.memoryFailures);
}

/** the notice when the plugin could not be asked at all — the agents have forgotten, the human still sees */
export function renderUnremovedNotice(input: Outcome & { readonly reason: string }): string {
  const lead = `🧹 ${input.byUsername} cleared this channel for the agents; the posts could not be removed (${input.reason}). ${RUN_AGAIN}`;
  return withMemoryFailures(lead, input.memoryFailures);
}

/** the notice when the store transaction rolled back, so nothing anywhere changed */
export function renderFailedNotice(): string {
  return '🧹 Clear failed before anything was removed.';
}

export function renderRefusal(refusal: ClearingRefusal): string {
  return match(refusal)
    .with({ kind: 'busy' }, ({ agentUsernames }) => {
      const named = agentUsernames.join(', ');
      return agentUsernames.length === 1
        ? `A turn is running here (${named}). Stop or kill it first: /collegium stop or /collegium kill.`
        : `Turns are running here (${named}). Stop or kill them first: /collegium stop or /collegium kill.`;
    })
    .with({ kind: 'dialog-undeliverable' }, { kind: 'no-trigger' }, () => {
      return `The confirmation could not be opened. ${RUN_AGAIN}`;
    })
    .with({ kind: 'expired' }, () => `This confirmation has expired. ${RUN_AGAIN}`)
    .with({ kind: 'store-failed' }, () => 'The clear failed before anything was removed. See the app log.')
    .with({ kind: 'unannounced' }, () => {
      return 'The announcement could not be posted in this channel, so nothing was changed.';
    })
    .exhaustive();
}
