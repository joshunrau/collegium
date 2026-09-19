import { $Config } from '@collegium/config';
import { z } from 'zod';

/**
 * config.json's text to the parsed config, or a boot refusal an operator can read: the schema's
 * issues as prose naming each path, not the issue array as JSON.
 */
export function parseConfigText(text: string, filepath: string): $Config {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`the config at "${filepath}" is not valid JSON`, { cause: error });
  }
  const parsed = $Config.safeParse(json);
  if (!parsed.success) {
    throw new Error(`invalid config at "${filepath}":\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
