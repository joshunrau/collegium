/** §3.4 — how many characters two captures of a page share from their start: where a page that grew first differs */
export function measureUnchangedPrefix(previous: string, current: string): number {
  const bound = Math.min(previous.length, current.length);
  let index = 0;
  while (index < bound && previous.charCodeAt(index) === current.charCodeAt(index)) {
    index++;
  }
  return index;
}
