/** the subcommand a human typed after `/collegium`, and whatever followed it */
export function splitLeadingWord(text: string): { rest: string; word: string } {
  const [word = '', ...rest] = text.trim().split(/\s+/u);
  return { rest: rest.join(' '), word };
}
