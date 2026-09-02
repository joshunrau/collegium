/** the first whitespace-delimited token of a command's text, and everything after it */
export function splitSubcommand(text: string): { remainder: string; subcommand: string | undefined } {
  const [subcommand, ...rest] = text.split(/\s+/u).filter(Boolean);
  return { remainder: rest.join(' '), subcommand };
}
