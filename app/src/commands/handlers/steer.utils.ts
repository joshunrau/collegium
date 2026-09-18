/** §7.5 — the ephemeral answer says what a steer can and cannot reach, or it will be read as immediate */
export function renderSteerResponse(steered: number): string {
  if (steered === 0) {
    return 'Nothing is running in this channel, so there was nothing to steer.';
  }
  return `Handed to ${steered} running turn(s); each reads it before its next model call, and a call already in flight is made again. A tool already running is not interrupted, and a turn waiting on an approval reads it only if it continues after the answer.`;
}
