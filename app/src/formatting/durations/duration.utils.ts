const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** how long ago something happened, to the two largest units a human cares about at that scale */
export function renderElapsed(elapsedMs: number): string {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed >= MS_PER_DAY) {
    return `${Math.floor(elapsed / MS_PER_DAY)}d ${Math.floor((elapsed % MS_PER_DAY) / MS_PER_HOUR)}h`;
  }
  if (elapsed >= MS_PER_HOUR) {
    return `${Math.floor(elapsed / MS_PER_HOUR)}h ${Math.floor((elapsed % MS_PER_HOUR) / MS_PER_MINUTE)}m`;
  }
  if (elapsed >= MS_PER_MINUTE) {
    return `${Math.floor(elapsed / MS_PER_MINUTE)}m`;
  }
  return 'under a minute';
}

/** how long something ran, to the second: minutes and seconds past the first minute, as a status post's closing line states it (§8.1) */
export function renderDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}
