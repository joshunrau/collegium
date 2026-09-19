const MEMORIES_FLAG = '--memories';

/** the one flag `/collegium clear` takes; anything else is answered with the usage line */
export function parseClearArguments(text: string): undefined | { memories: boolean } {
  const tokens = text
    .trim()
    .split(/\s+/u)
    .filter((token) => token !== '');
  if (tokens.length === 0) {
    return { memories: false };
  }
  if (tokens.length === 1 && tokens[0] === MEMORIES_FLAG) {
    return { memories: true };
  }
  return undefined;
}
