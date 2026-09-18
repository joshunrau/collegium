/** §3.8 — a run of one repeated action reads as the line and its count, so a retried call is not the whole section */
export function collapseRepeatedLines(lines: readonly string[]): string[] {
  const runs: { count: number; line: string }[] = [];
  for (const line of lines) {
    const current = runs.at(-1);
    if (current?.line === line) {
      current.count += 1;
    } else {
      runs.push({ count: 1, line });
    }
  }
  return runs.map(({ count, line }) => (count === 1 ? line : `${line} (x${count})`));
}
