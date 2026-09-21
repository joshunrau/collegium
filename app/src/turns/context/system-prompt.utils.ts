const APPROXIMATE_TOKEN_FORMAT = new Intl.NumberFormat('en-US');

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

/** §3.8 — a figure stated as "about" is rounded to the thousand, so six significant digits are not read as an exact count */
export function formatApproximateTokens(tokens: number): string {
  return APPROXIMATE_TOKEN_FORMAT.format(Math.round(tokens / 1000) * 1000);
}
