import type { $Plugin } from '@collegium/core/plugins';
import type { Skill } from '@collegium/core/skills';

export type LoadedPlugin = {
  readonly manifest: $Plugin;
  /** parsed through the schema the contract declares; undefined when the plugin declares none */
  readonly settings: unknown;
  /** keyed by bare skill name; qualified at registration */
  readonly skills: Readonly<{ [key: string]: Skill }>;
};
